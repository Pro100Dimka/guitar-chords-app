//! Streaming, on-device chord inference from independently detected note events.
//!
//! 16 kHz PCM -> embedded Basic Pitch notes/onsets -> stable roots -> supported
//! chord quality. No song identity, expected progression, annotation, or network
//! enters this module. Confidence describes evidence strength, not probability.
use crate::chord_notes::{NoteAnalyzer, NoteFrame, FIRST_MIDI_NOTE, NOTE_COUNT};
use crate::note_events::{self, NoteEvents, MAX_NOTE_EVENTS, NOTE_EVENTS_VERSION};
use chfft::RFft1D;
use std::f32::consts::PI;
use std::fmt::Write;

pub const SAMPLE_RATE: usize = 16_000;
pub const MAX_SAMPLES: usize = SAMPLE_RATE * 900;
const WINDOW: usize = 8192;
const HOP: usize = 1024;
const CONTEXT_RADIUS: usize = 6;
const ENVELOPE_HOP: usize = 256;
const NOTE_BLOCK: usize = 4096;
// The native model emits one observation per 256 source samples. Actual frame
// times come from NoteFrame; this nominal step only sizes local evidence windows.
const NOTE_STEP: f64 = 256.0 / 22_050.0;
const ARPEGGIO_HISTORY_SECONDS: f64 = 1.8;
const NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];
const QUALITIES: [(&str, &[usize]); 14] = [
    ("", &[0, 4, 7]),
    ("m", &[0, 3, 7]),
    ("5", &[0, 7]),
    ("sus2", &[0, 2, 7]),
    ("sus4", &[0, 5, 7]),
    ("6", &[0, 4, 7, 9]),
    ("m6", &[0, 3, 7, 9]),
    ("7", &[0, 4, 7, 10]),
    ("maj7", &[0, 4, 7, 11]),
    ("m7", &[0, 3, 7, 10]),
    ("dim", &[0, 3, 6]),
    ("aug", &[0, 4, 8]),
    ("add9", &[0, 2, 4, 7]),
    ("madd9", &[0, 2, 3, 7]),
];
const UNKNOWN: usize = QUALITIES.len() * 12;
const STATES: usize = UNKNOWN + 1;

#[derive(Clone)]
struct Feature {
    chroma: [f32; 12],
    bass: [f32; 12],
    rms: f32,
    tonal: f32,
}

#[derive(Debug, Clone)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub chord: String,
    pub confidence: f32,
}

#[derive(Debug, Clone)]
pub struct Analysis {
    pub duration: f64,
    pub segments: Vec<Segment>,
    pub key: Option<String>,
    pub tempo: Option<f64>,
    pub note_events: NoteEvents,
}

impl Analysis {
    // Labels are internal ASCII; neither file names nor user text enter JSON.
    pub fn json(&self) -> String {
        let mut out = format!(
            "{{\"engine\":\"chroma-v2\",\"duration\":{:.6},\"key\":",
            self.duration
        );
        match &self.key {
            Some(key) => {
                let _ = write!(out, "\"{key}\"");
            }
            None => out.push_str("null"),
        }
        out.push_str(",\"tempo\":");
        match self.tempo {
            Some(tempo) => {
                let _ = write!(out, "{tempo:.2}");
            }
            None => out.push_str("null"),
        }
        out.push_str(",\"segments\":[");
        for (i, segment) in self.segments.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            let _ = write!(
                out,
                "{{\"start\":{:.6},\"end\":{:.6},\"chord\":\"{}\",\"confidence\":{:.4}}}",
                segment.start, segment.end, segment.chord, segment.confidence
            );
        }
        let _ = write!(
            out,
            "],\"noteEventsVersion\":{},\"noteEventsLimit\":{},\"noteEventsTruncated\":{},\"noteEventsCoverageEnd\":{:.6},\"noteEvents\":[",
            NOTE_EVENTS_VERSION,
            MAX_NOTE_EVENTS,
            self.note_events.truncated,
            self.note_events.coverage_end
        );
        for (index, event) in self.note_events.events.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            let _ = write!(
                out,
                "{{\"start\":{:.6},\"end\":{:.6},\"midi\":{},\"noteEvidence\":{:.4},\"onsetEvidence\":{:.4}}}",
                event.start,
                event.end,
                event.midi,
                event.note_evidence,
                event.onset_evidence
            );
        }
        out.push_str("]}");
        out
    }
}

/// Fixed-capacity blocks avoid a large Vec reallocating/copying the entire
/// recording. At 15 minutes, raw features occupy about 57 MB plus one block.
/// PCM is retained only in the bounded FFT/model analysis windows.
#[derive(Default)]
struct NoteStorage {
    blocks: Vec<Vec<NoteFrame>>,
    len: usize,
}

impl note_events::NoteFrames for NoteStorage {
    fn len(&self) -> usize {
        self.len
    }

    fn frame(&self, index: usize) -> &NoteFrame {
        self.get(index)
    }
}

impl NoteStorage {
    fn extend(&mut self, frames: Vec<NoteFrame>) {
        for frame in frames {
            if self.len % NOTE_BLOCK == 0 {
                self.blocks.push(Vec::with_capacity(NOTE_BLOCK));
            }
            self.blocks.last_mut().unwrap().push(frame);
            self.len += 1;
        }
    }

    fn get(&self, index: usize) -> &NoteFrame {
        &self.blocks[index / NOTE_BLOCK][index % NOTE_BLOCK]
    }

    fn lower_bound(&self, time: f64) -> usize {
        let (mut lo, mut hi) = (0, self.len);
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if self.get(mid).time < time {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo
    }

    fn range(&self, start: f64, end: f64) -> (usize, usize) {
        let lo = self.lower_bound(start).min(self.len - 1);
        let hi = self.lower_bound(end).max(lo + 1).min(self.len);
        (lo, hi)
    }

    fn chroma_at(&self, time: f64) -> ([f32; 12], [f32; 12]) {
        let upper = self.lower_bound(time).min(self.len - 1);
        let lower = upper.saturating_sub(1);
        let a = self.get(lower);
        let b = self.get(upper);
        let weight = if b.time > a.time {
            ((time - a.time) / (b.time - a.time)).clamp(0.0, 1.0) as f32
        } else {
            0.0
        };
        let mut chroma = [0.0; 12];
        let mut bass = [0.0; 12];
        for note in 0..NOTE_COUNT {
            let probability = a.notes[note] * (1.0 - weight) + b.notes[note] * weight;
            // Soft evidence is suitable for root anchoring. Quality inference
            // below separately requires independent attacks and removes floor.
            let value = ((probability - 0.05) / 0.95).max(0.0);
            let midi = FIRST_MIDI_NOTE + note;
            chroma[midi % 12] += value * treble_weight(midi);
            bass[midi % 12] += value * (-0.5 * ((midi as f32 - 40.0) / 10.0).powi(2)).exp();
        }
        normalize(&mut chroma);
        normalize(&mut bass);
        (chroma, bass)
    }
}

pub struct ChordAnalyzer {
    fft: RFft1D<f32>,
    window: Vec<f32>,
    pending: Vec<f32>,
    frames: Vec<Feature>,
    envelope: Vec<f32>,
    energy: f32,
    energy_count: usize,
    samples: usize,
    finished: bool,
    note_analyzer: NoteAnalyzer,
    notes: NoteStorage,
}

impl Default for ChordAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

impl ChordAnalyzer {
    /// Host diagnostics can inspect the exact retained model frames without
    /// changing them or evaluating the model again. Return false to stop early.
    pub(crate) fn visit_note_frames<E>(
        &self,
        mut visit: impl FnMut(&NoteFrame) -> Result<bool, E>,
    ) -> Result<(), E> {
        for frame in self.notes.blocks.iter().flatten() {
            if !visit(frame)? {
                break;
            }
        }
        Ok(())
    }

    /// Read-only access for host decoder comparisons on the same model pass.
    pub(crate) fn retained_note_frame_count(&self) -> usize {
        self.notes.len
    }

    pub(crate) fn retained_note_frame(&self, index: usize) -> &NoteFrame {
        self.notes.get(index)
    }

    pub fn new() -> Self {
        Self {
            fft: RFft1D::new(WINDOW),
            window: (0..WINDOW)
                .map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / (WINDOW - 1) as f32).cos())
                .collect(),
            pending: vec![0.0; WINDOW / 2],
            frames: Vec::new(),
            envelope: Vec::new(),
            energy: 0.0,
            energy_count: 0,
            samples: 0,
            finished: false,
            note_analyzer: NoteAnalyzer::new(),
            notes: NoteStorage::default(),
        }
    }

    pub fn push(&mut self, pcm: &[i16]) -> Result<(), &'static str> {
        if self.finished {
            return Err("AnalysisFinished");
        }
        if pcm.len() > MAX_SAMPLES.saturating_sub(self.samples) {
            return Err("AudioTooLong");
        }
        for chunk in pcm.chunks(16_384) {
            match self.note_analyzer.push16k(chunk) {
                Ok(frames) => self.notes.extend(frames),
                Err(error) => {
                    self.finished = true;
                    return Err(error);
                }
            }
            for &sample in chunk {
                let x = sample as f32 / 32768.0;
                self.pending.push(x);
                self.energy += x * x;
                self.energy_count += 1;
                if self.energy_count == ENVELOPE_HOP {
                    self.envelope
                        .push((self.energy / ENVELOPE_HOP as f32).sqrt());
                    self.energy = 0.0;
                    self.energy_count = 0;
                }
            }
            self.samples += chunk.len();
            self.extract();
        }
        Ok(())
    }

    fn extract(&mut self) {
        let mut offset = 0;
        while offset + WINDOW <= self.pending.len() {
            let input = &self.pending[offset..offset + WINDOW];
            let rms = (input.iter().map(|x| x * x).sum::<f32>() / WINDOW as f32).sqrt();
            let windowed: Vec<f32> = input.iter().zip(&self.window).map(|(x, w)| x * w).collect();
            let spectrum = self.fft.forward(&windowed);
            let first = 55 * WINDOW / SAMPLE_RATE;
            let last = 4000 * WINDOW / SAMPLE_RATE;
            let mut energy = 0.0;
            let mut logarithm = 0.0;
            for value in &spectrum[first..last] {
                let power = value.norm_sqr();
                energy += power;
                logarithm += power.max(1e-12).ln();
            }
            let width = (last - first) as f32;
            let flatness = (logarithm / width).exp() / (energy / width).max(1e-12);
            self.frames.push(Feature {
                chroma: [0.0; 12],
                bass: [0.0; 12],
                rms,
                tonal: (1.0 - flatness).clamp(0.0, 1.0),
            });
            offset += HOP;
        }
        if offset > 0 {
            self.pending.drain(..offset);
        }
    }

    pub fn finish(&mut self) -> Result<Analysis, &'static str> {
        if self.finished {
            return Err("AnalysisFinished");
        }
        if self.samples < SAMPLE_RATE {
            return Err("AudioTooShort");
        }
        self.finished = true;
        self.notes.extend(self.note_analyzer.finish()?);
        if self.notes.len == 0 {
            return Err("AudioAnalysisFailed");
        }
        self.pending.resize(self.pending.len() + WINDOW / 2, 0.0);
        self.extract();
        self.frames.truncate(self.samples.div_ceil(HOP));
        for (index, frame) in self.frames.iter_mut().enumerate() {
            (frame.chroma, frame.bass) = self
                .notes
                .chroma_at(index as f64 * HOP as f64 / SAMPLE_RATE as f64);
        }
        let duration = self.samples as f64 / SAMPLE_RATE as f64;
        let peak_rms = self.frames.iter().map(|x| x.rms).fold(0.0, f32::max);
        let silence = (peak_rms * 0.008).max(0.0003);
        let mut scores = Vec::with_capacity(self.frames.len());
        let mut histogram = [0.0; 12];
        let mut musical_frames = 0;
        for (index, feature) in self.frames.iter().enumerate() {
            let mut chroma = [0.0; 12];
            let mut bass = [0.0; 12];
            for offset in -(CONTEXT_RADIUS as isize)..=CONTEXT_RADIUS as isize {
                let neighbor =
                    (index as isize + offset).clamp(0, self.frames.len() as isize - 1) as usize;
                let weight = (CONTEXT_RADIUS + 1 - offset.unsigned_abs()) as f32;
                for pc in 0..12 {
                    chroma[pc] += self.frames[neighbor].chroma[pc] * weight;
                    bass[pc] += self.frames[neighbor].bass[pc] * weight;
                }
            }
            normalize(&mut chroma);
            normalize(&mut bass);
            let mut emission = chord_scores(&chroma, &bass);
            let maximum = emission[..UNKNOWN]
                .iter()
                .copied()
                .fold(f32::NEG_INFINITY, f32::max);
            let largest = chroma.iter().copied().fold(0.0, f32::max);
            let count = chroma.iter().filter(|&&v| v > largest * 0.22).count();
            if feature.rms < silence || feature.tonal < 0.60 || count < 2 || maximum < 0.55 {
                emission.fill(-2.0);
                emission[UNKNOWN] = 1.0;
            } else {
                emission[UNKNOWN] = if count < 3 { 0.65 } else { 0.35 };
                for pc in 0..12 {
                    histogram[pc] += chroma[pc];
                }
                musical_frames += 1;
            }
            scores.push(emission);
        }
        let path = smooth_path(&scores);
        let spans = root_spans(&path, &scores, duration);
        // Scores/backtracking are no longer needed while pooling native notes.
        drop(scores);
        let segments = infer_quality(&self.notes, &spans);
        // This independent decoder reads the same immutable model observations.
        // Neither its events nor any inferred playing style affect chord labels.
        let note_events = note_events::decode(&self.notes, duration);
        let recognized: f64 = segments
            .iter()
            .filter(|s| s.chord != "N")
            .map(|s| s.end - s.start)
            .sum();
        let musical = musical_frames >= 20 && recognized >= duration / 3.0;
        Ok(Analysis {
            duration,
            segments,
            note_events,
            key: if musical {
                estimate_key(&histogram)
            } else {
                None
            },
            tempo: if musical {
                estimate_tempo(&self.envelope)
            } else {
                None
            },
        })
    }
}

fn treble_weight(midi: usize) -> f32 {
    ((midi as f32 - 27.0) / 21.0).clamp(0.0, 1.0) * ((111.0 - midi as f32) / 27.0).clamp(0.0, 1.0)
}

fn normalize(values: &mut [f32; 12]) {
    let norm = values.iter().map(|v| v * v).sum::<f32>().sqrt().max(1e-12);
    for value in values {
        *value /= norm;
    }
}

fn chord_name(index: usize) -> String {
    if index == UNKNOWN {
        "N".into()
    } else {
        format!("{}{}", NAMES[index % 12], QUALITIES[index / 12].0)
    }
}

fn chord_scores(chroma: &[f32; 12], bass: &[f32; 12]) -> [f32; STATES] {
    let mut scores = [0.0; STATES];
    for (quality, &(suffix, intervals)) in QUALITIES.iter().enumerate() {
        for root in 0..12 {
            scores[quality * 12 + root] = intervals
                .iter()
                .map(|&i| chroma[(root + i) % 12])
                .sum::<f32>()
                / (intervals.len() as f32).sqrt()
                + 0.12 * bass[root]
                - 0.025 * intervals.len().saturating_sub(3) as f32
                - if suffix == "5" { 0.045 } else { 0.0 };
        }
    }
    scores
}

fn prefer(candidate: (usize, f64), best: &mut (usize, f64)) {
    if candidate.1 > best.1 || (candidate.1 == best.1 && candidate.0 < best.0) {
        *best = candidate;
    }
}

fn smooth_path(scores: &[[f32; STATES]]) -> Vec<usize> {
    if scores.is_empty() {
        return Vec::new();
    }
    let mut previous = scores[0].map(f64::from);
    let mut back = vec![[0u8; STATES]; scores.len()];
    for i in 1..scores.len() {
        let mut by_root = [(0, f64::NEG_INFINITY); 12];
        let mut global = (0, f64::NEG_INFINITY);
        for (state, &value) in previous[..UNKNOWN].iter().enumerate() {
            prefer((state, value), &mut by_root[state % 12]);
            prefer((state, value), &mut global);
        }
        let mut next = [0.0; STATES];
        for state in 0..STATES {
            let mut best = (state, previous[state]);
            if state == UNKNOWN {
                prefer((global.0, global.1 - 0.85 * 0.47), &mut best);
            } else {
                let same = by_root[state % 12];
                prefer((same.0, same.1 - 0.85 * 0.8), &mut best);
                prefer((global.0, global.1 - 0.85), &mut best);
                prefer((UNKNOWN, previous[UNKNOWN] - 0.85 * 0.47), &mut best);
            }
            next[state] = best.1 + scores[i][state] as f64;
            back[i][state] = best.0 as u8;
        }
        let highest = next.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        for value in &mut next {
            *value -= highest;
        }
        previous = next;
    }
    let mut best = (0, f64::NEG_INFINITY);
    for (state, &value) in previous.iter().enumerate() {
        prefer((state, value), &mut best);
    }
    let mut path = vec![0; scores.len()];
    path[scores.len() - 1] = best.0;
    for i in (1..scores.len()).rev() {
        path[i - 1] = back[i][path[i]] as usize;
    }
    path
}

#[derive(Clone)]
struct RootSpan {
    start: f64,
    end: f64,
    root: Option<usize>,
    confidence: f32,
    frame_segments: Vec<FrameSegment>,
}

#[derive(Clone)]
struct FrameSegment {
    start: f64,
    end: f64,
    label: usize,
}

fn root_spans(path: &[usize], scores: &[[f32; STATES]], duration: f64) -> Vec<RootSpan> {
    let mut spans: Vec<RootSpan> = Vec::new();
    let mut lo = 0;
    while lo < path.len() {
        let label = path[lo];
        let mut hi = lo + 1;
        while hi < path.len() && path[hi] == label {
            hi += 1;
        }
        let mut confidence = 0.0;
        if label != UNKNOWN {
            for score in &scores[lo..hi] {
                let other = score[..UNKNOWN]
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != label)
                    .map(|(_, &v)| v)
                    .fold(f32::NEG_INFINITY, f32::max);
                confidence += ((score[label] - 0.45) * 0.85
                    + (score[label] - other).max(0.0) * 2.0)
                    .clamp(0.0, 1.0);
            }
            confidence /= (hi - lo) as f32;
        }
        let span = RootSpan {
            start: if lo == 0 {
                0.0
            } else {
                (lo as f64 - 0.5) * HOP as f64 / SAMPLE_RATE as f64
            },
            end: if hi == path.len() {
                duration
            } else {
                (hi as f64 - 0.5) * HOP as f64 / SAMPLE_RATE as f64
            },
            root: if label == UNKNOWN {
                None
            } else {
                Some(label % 12)
            },
            confidence,
            frame_segments: Vec::new(),
        };
        let frame_segment = FrameSegment {
            start: span.start,
            end: span.end,
            label,
        };
        if let Some(last) = spans.last_mut().filter(|last| last.root == span.root) {
            last.end = span.end;
            last.confidence = last.confidence.min(span.confidence);
            last.frame_segments.push(frame_segment);
        } else {
            let mut span = span;
            span.frame_segments.push(frame_segment);
            spans.push(span);
        }
        lo = hi;
    }
    spans
}

// Independent local-max/prominence implementation. Root peaks only align a
// quality replacement that has separate note evidence; re-plucks never split
// an arpeggio by themselves. Plateau centers and endpoints are deterministic.
fn peaks(curve: &[f32], height: f32, distance: usize, prominence: f32) -> Vec<usize> {
    let mut candidates = Vec::new();
    let mut i = 1;
    while i + 1 < curve.len() {
        if curve[i] > curve[i - 1] {
            let mut right = i;
            while right + 1 < curve.len() && curve[right + 1] == curve[i] {
                right += 1;
            }
            if right + 1 < curve.len() && curve[right] > curve[right + 1] && curve[i] >= height {
                candidates.push((i + right) / 2);
            }
            i = right + 1;
        } else {
            i += 1;
        }
    }
    candidates.sort_by(|&a, &b| curve[b].total_cmp(&curve[a]).then(b.cmp(&a)));
    let mut separated: Vec<usize> = Vec::new();
    for candidate in candidates {
        if separated
            .iter()
            .all(|&other| candidate.abs_diff(other) >= distance)
        {
            separated.push(candidate);
        }
    }
    separated.retain(|&peak| {
        let mut left_min = curve[peak];
        for j in (0..peak).rev() {
            if curve[j] > curve[peak] {
                break;
            }
            left_min = left_min.min(curve[j]);
        }
        let mut right_min = curve[peak];
        for &value in &curve[peak + 1..] {
            if value > curve[peak] {
                break;
            }
            right_min = right_min.min(value);
        }
        curve[peak] - left_min.max(right_min) >= prominence
    });
    separated.sort_unstable();
    separated
}

fn note_evidence(
    storage: &NoteStorage,
    lo: usize,
    hi: usize,
) -> ([f32; NOTE_COUNT], [f32; NOTE_COUNT], [usize; NOTE_COUNT]) {
    let mut note_peak = [0.0f32; NOTE_COUNT];
    let mut onset_peak = [0.0f32; NOTE_COUNT];
    let mut supported = [0; NOTE_COUNT];
    for i in lo..hi {
        let frame = storage.get(i);
        for note in 0..NOTE_COUNT {
            note_peak[note] = note_peak[note].max(frame.notes[note]);
            onset_peak[note] = onset_peak[note].max(frame.onsets[note]);
            supported[note] += usize::from(frame.notes[note] >= 0.35);
        }
    }
    (note_peak, onset_peak, supported)
}

fn credible_note(note_peak: f32, onset_peak: f32, supported_frames: usize) -> bool {
    let seconds = supported_frames as f64 * NOTE_STEP;
    seconds >= 0.06 && (onset_peak >= 0.5 || note_peak >= 0.65)
}

#[derive(Default)]
struct AttackEvidence {
    paired: f32,
    fresh_onset: f32,
    fresh_paired: f32,
}

fn note_attack_evidence(
    storage: &NoteStorage,
    lo: usize,
    hi: usize,
    note: usize,
) -> AttackEvidence {
    // The model's onset and frame heads need not peak on the same frame. Use
    // the same local note radius as quality-change events, rather than joining
    // unrelated maxima from anywhere in a multi-second chord span.
    let radius = (0.06 / NOTE_STEP) as usize;
    let local_note_peak = |frame: usize| {
        (frame.saturating_sub(radius).max(lo)..=(frame + radius).min(hi - 1))
            .map(|i| storage.get(i).notes[note])
            .fold(0.0, f32::max)
    };
    let mut evidence = AttackEvidence::default();
    for frame in lo..hi {
        let onset = storage.get(frame).onsets[note];
        if onset >= 0.15 {
            evidence.paired = evidence.paired.max(onset * local_note_peak(frame));
        }
    }
    // Include one adjacent frame to distinguish a new attack at a boundary
    // from the monotonically decaying tail of an earlier attack.
    let start = lo.saturating_sub(1);
    let end = (hi + 1).min(storage.len);
    let curve: Vec<f32> = (start..end)
        .map(|frame| storage.get(frame).onsets[note])
        .collect();
    let mut attacks = peaks(&curve, 0.15, 1, 0.12);
    if lo == 0 {
        attacks.push(0);
    }
    for frame in attacks {
        let index = start + frame;
        if lo <= index && index < hi {
            let nearby_note = local_note_peak(index);
            if nearby_note >= 0.35 {
                evidence.fresh_onset = evidence.fresh_onset.max(curve[frame]);
                evidence.fresh_paired = evidence.fresh_paired.max(curve[frame] * nearby_note);
            }
        }
    }
    evidence
}

fn pitch_activity(
    storage: &NoteStorage,
    frame: usize,
    pc: usize,
    reliable: &[bool; NOTE_COUNT],
) -> f32 {
    (0..NOTE_COUNT)
        .filter(|&note| reliable[note] && (FIRST_MIDI_NOTE + note) % 12 == pc)
        .map(|note| storage.get(frame).notes[note])
        .fold(0.0, f32::max)
}

// The soft root path can mistake a loud inversion bass plus model background
// for an extended chord. Repair only an impossible anchored formula: every
// candidate tone must have independently supported above-background evidence.
// If any formula fits the anchored root, retain it; bass is never forced=root.
fn supported_root(
    storage: &NoteStorage,
    begin: usize,
    end: usize,
    anchored: usize,
    reliable: &[bool; NOTE_COUNT],
) -> usize {
    let mut chroma = [0.0f32; 12];
    for note in 0..NOTE_COUNT {
        if !reliable[note] {
            continue;
        }
        let mass = (begin..end)
            .map(|frame| (storage.get(frame).notes[note] as f64 - 0.1).max(0.0))
            .sum::<f64>()
            / (end - begin) as f64;
        let midi = FIRST_MIDI_NOTE + note;
        chroma[midi % 12] += mass as f32 * treble_weight(midi);
    }
    for value in &mut chroma {
        *value = value.sqrt();
    }
    normalize(&mut chroma);
    let largest = chroma.iter().copied().fold(0.0, f32::max);
    let complete = |root: usize, tones: &[usize]| {
        tones
            .iter()
            .all(|&tone| chroma[(root + tone) % 12] > largest * 0.15)
    };
    if QUALITIES.iter().any(|(_, tones)| complete(anchored, tones)) {
        return anchored;
    }
    let scores = chord_scores(&chroma, &[0.0; 12]);
    let mut best = (anchored, f32::NEG_INFINITY);
    for (state, &score) in scores[..UNKNOWN].iter().enumerate() {
        if score > best.1 && complete(state % 12, QUALITIES[state / 12].1) {
            best = (state % 12, score);
        }
    }
    best.0
}

// A stable completed chord can acquire/lose an extension without changing its
// root. Retain that boundary only when the old and new formulae both have raw
// persistent note evidence. A two-note arpeggio prefix is never a completed
// chord, so it remains pooled with its delayed third or suspension.
fn extension_boundaries(
    storage: &NoteStorage,
    span: &RootSpan,
    reliable: &[bool; NOTE_COUNT],
) -> Vec<f64> {
    let Some(root) = span.root else {
        return Vec::new();
    };
    let mut boundaries = Vec::new();
    for pair in span.frame_segments.windows(2) {
        let previous = &pair[0];
        let current = &pair[1];
        let old = QUALITIES[previous.label / 12].1;
        let new = QUALITIES[current.label / 12].1;
        if old.len() < 3 || new.len() < 3 {
            continue;
        }
        let added: Vec<usize> = new
            .iter()
            .copied()
            .filter(|tone| !old.contains(tone))
            .collect();
        let removed: Vec<usize> = old
            .iter()
            .copied()
            .filter(|tone| !new.contains(tone))
            .collect();
        if !added.is_empty()
            && !removed.is_empty()
            && added
                .iter()
                .chain(&removed)
                .all(|tone| [2, 3, 4, 5].contains(tone))
        {
            continue;
        }
        if previous.end - previous.start < 0.65 || current.end - current.start < 0.35 {
            continue;
        }
        let mut boundary = current.start;
        let before = storage.lower_bound(previous.start.max(boundary - 0.65))
            ..storage.lower_bound(boundary - 0.10);
        let after = storage.lower_bound(boundary + 0.10)
            ..storage.lower_bound(current.end.min(boundary + 0.65));
        if before.len() as f64 * NOTE_STEP < 0.30 || after.len() as f64 * NOTE_STEP < 0.25 {
            continue;
        }
        let sustained = |range: std::ops::Range<usize>, interval: usize, seconds: f64| {
            range
                .filter(|&frame| {
                    pitch_activity(storage, frame, (root + interval) % 12, reliable) >= 0.20
                })
                .count() as f64
                * NOTE_STEP
                >= seconds
        };
        if old
            .iter()
            .any(|&tone| !sustained(before.clone(), tone, 0.30))
            || new
                .iter()
                .any(|&tone| !sustained(after.clone(), tone, 0.25))
        {
            continue;
        }
        let mean = |range: std::ops::Range<usize>, interval: usize| {
            let count = range.len();
            range
                .map(|frame| {
                    pitch_activity(storage, frame, (root + interval) % 12, reliable) as f64
                })
                .sum::<f64>()
                / count as f64
        };
        if added.iter().any(|&tone| mean(before.clone(), tone) >= 0.20)
            || removed
                .iter()
                .any(|&tone| mean(after.clone(), tone) >= 0.20)
        {
            continue;
        }
        let local = storage.lower_bound(boundary - 0.18)..storage.lower_bound(boundary + 0.18);
        let mut independent = true;
        let mut nearest: Option<f64> = None;
        for interval in added {
            let selected: Vec<usize> = (0..NOTE_COUNT)
                .filter(|&note| {
                    reliable[note] && (FIRST_MIDI_NOTE + note) % 12 == (root + interval) % 12
                })
                .collect();
            let mut supported = false;
            for frame in local.clone() {
                let observation = storage.get(frame);
                let onset = selected
                    .iter()
                    .map(|&note| observation.onsets[note])
                    .fold(0.0, f32::max);
                let note = selected
                    .iter()
                    .map(|&note| observation.notes[note])
                    .fold(0.0, f32::max);
                supported |= onset >= 0.5 || note >= 0.65;
                if onset >= 0.5
                    && nearest.is_none_or(|time| {
                        (observation.time - boundary).abs() < (time - boundary).abs()
                    })
                {
                    nearest = Some(observation.time);
                }
            }
            if !supported {
                independent = false;
                break;
            }
        }
        if !independent {
            continue;
        }
        if let Some(time) = nearest {
            boundary = time;
        }
        boundaries.push(boundary);
    }
    boundaries
}

fn infer_quality(storage: &NoteStorage, spans: &[RootSpan]) -> Vec<Segment> {
    let mut result = Vec::new();
    for span in spans {
        let Some(anchored_root) = span.root else {
            merge_segment(
                &mut result,
                Segment {
                    start: span.start,
                    end: span.end,
                    chord: "N".into(),
                    confidence: 0.0,
                },
            );
            continue;
        };
        let (begin, end) = storage.range(span.start, span.end);
        let count = end - begin;
        let (note_peak, onset_peak, supported) = note_evidence(storage, begin, end);
        let reliable: [bool; NOTE_COUNT] = std::array::from_fn(|note| {
            credible_note(note_peak[note], onset_peak[note], supported[note])
        });
        let root = supported_root(storage, begin, end, anchored_root, &reliable);
        let root_notes: Vec<usize> = (0..NOTE_COUNT)
            .filter(|&note| (FIRST_MIDI_NOTE + note) % 12 == root && note_peak[note] >= 0.35)
            .collect();
        let root_curve: Vec<f32> = (begin..end)
            .map(|i| {
                root_notes
                    .iter()
                    .map(|&note| storage.get(i).onsets[note])
                    .fold(0.0, f32::max)
            })
            .collect();
        let root_attacks: Vec<f64> = peaks(&root_curve, 0.4, (0.18 / NOTE_STEP) as usize, 0.12)
            .into_iter()
            .map(|i| storage.get(begin + i).time)
            .collect();
        let intervals = [2, 3, 4, 5];
        let mut activity = vec![[0.0f32; 4]; count];
        let mut events: Vec<(usize, usize)> = Vec::new();
        let peak_radius = (0.06 / NOTE_STEP) as usize;
        let support_radius = (0.12 / NOTE_STEP) as usize;
        for (class, interval) in intervals.iter().enumerate() {
            let selected: Vec<usize> = (0..NOTE_COUNT)
                .filter(|&note| (FIRST_MIDI_NOTE + note) % 12 == (root + interval) % 12)
                .collect();
            let mut curve = vec![0.0f32; count];
            for frame in 0..count {
                for &note in &selected {
                    activity[frame][class] =
                        activity[frame][class].max(storage.get(begin + frame).notes[note]);
                    let local_peak = (frame.saturating_sub(peak_radius)
                        ..=(frame + peak_radius).min(count - 1))
                        .map(|i| storage.get(begin + i).notes[note])
                        .fold(0.0, f32::max);
                    let local_support = (frame.saturating_sub(support_radius)
                        ..=(frame + support_radius).min(count - 1))
                        .filter(|&i| storage.get(begin + i).notes[note] >= 0.35)
                        .count();
                    if local_peak >= 0.35 && local_support as f64 * NOTE_STEP >= 0.06 {
                        curve[frame] = curve[frame].max(storage.get(begin + frame).onsets[note]);
                    }
                }
            }
            events.extend(
                peaks(&curve, 0.5, (0.15 / NOTE_STEP) as usize, 0.12)
                    .into_iter()
                    .map(|frame| (frame, class)),
            );
        }
        events.sort_unstable();
        let initial_lo = begin.saturating_sub((0.10 / NOTE_STEP) as usize);
        let initial_hi = end
            .min(begin + (0.18 / NOTE_STEP) as usize)
            .max(initial_lo + 1);
        let (initial_note, initial_onset, initial_support) =
            note_evidence(storage, initial_lo, initial_hi);
        let mut current: Option<usize> = None;
        let mut initial_strength = 0.0;
        for (class, interval) in intervals.iter().enumerate() {
            for note in 0..NOTE_COUNT {
                if (FIRST_MIDI_NOTE + note) % 12 != (root + interval) % 12
                    || !credible_note(
                        initial_note[note],
                        initial_onset[note],
                        initial_support[note],
                    )
                {
                    continue;
                }
                let strength = (initial_lo..initial_hi)
                    .map(|i| storage.get(i).notes[note] as f64)
                    .sum::<f64>()
                    / (initial_hi - initial_lo) as f64;
                if strength > initial_strength {
                    current = Some(class);
                    initial_strength = strength;
                }
            }
        }
        let mut cuts = Vec::new();
        for (frame, class) in events {
            let Some(old) = current else {
                current = Some(class);
                continue;
            };
            if old == class {
                continue;
            }
            let after_lo = (frame + (0.04 / NOTE_STEP) as usize).min(count - 1);
            let after_hi = (frame + (0.25 / NOTE_STEP) as usize).min(count);
            if after_hi <= after_lo {
                continue;
            }
            let average = |c: usize| {
                activity[after_lo..after_hi]
                    .iter()
                    .map(|a| a[c] as f64)
                    .sum::<f64>()
                    / (after_hi - after_lo) as f64
            };
            if average(old) >= 0.25 || average(class) < 0.2 {
                continue;
            }
            let mut complete = [root, (root + 7) % 12].iter().all(|&pc| {
                let established: Vec<usize> = (0..NOTE_COUNT)
                    .filter(|&note| reliable[note] && (FIRST_MIDI_NOTE + note) % 12 == pc)
                    .collect();
                !established.is_empty()
                    && (after_lo..after_hi)
                        .filter(|&i| {
                            established
                                .iter()
                                .any(|&note| storage.get(begin + i).notes[note] >= 0.20)
                        })
                        .count() as f64
                        * NOTE_STEP
                        >= 0.06
            });
            if !complete {
                // A dry arpeggio establishes root/fifth sequentially. Their
                // independent attacks can precede the later defining third;
                // sounding simultaneously is not required for a complete chord.
                let history_lo =
                    frame.saturating_sub((ARPEGGIO_HISTORY_SECONDS / NOTE_STEP) as usize);
                complete = [root, (root + 7) % 12].iter().all(|&pc| {
                    let established: Vec<usize> = (0..NOTE_COUNT)
                        .filter(|&note| reliable[note] && (FIRST_MIDI_NOTE + note) % 12 == pc)
                        .collect();
                    !established.is_empty()
                        && (history_lo..after_hi)
                            .filter(|&i| {
                                established
                                    .iter()
                                    .any(|&note| storage.get(begin + i).notes[note] >= 0.35)
                            })
                            .count() as f64
                            * NOTE_STEP
                            >= 0.06
                });
            }
            if !complete {
                continue;
            }
            // A short ornament cannot rename the entire remaining root span.
            let sustain_end = count.min(frame + (0.45 / NOTE_STEP) as usize);
            let sustained = activity[frame..sustain_end]
                .iter()
                .filter(|a| a[class] >= 0.20)
                .count();
            if sustained as f64 * NOTE_STEP < 0.25 {
                continue;
            }
            let event_time = storage.get(begin + frame).time;
            let boundary = if (intervals[old] == 3 && intervals[class] == 4)
                || (intervals[old] == 4 && intervals[class] == 3)
            {
                // An old third that keeps sounding prevents retrospective
                // relabelling. Dry arpeggios may align to a recent root attack
                // after it ceases, with a small decay/alignment tolerance.
                let lookback =
                    frame.saturating_sub((ARPEGGIO_HISTORY_SECONDS / NOTE_STEP) as usize);
                let last_active = (lookback..frame)
                    .rev()
                    .find(|&i| activity[i][old] >= 0.35)
                    .unwrap_or(lookback);
                let cessation = storage.get(begin + last_active).time;
                let earliest = (event_time - ARPEGGIO_HISTORY_SECONDS).max(cessation - 0.15);
                root_attacks
                    .iter()
                    .copied()
                    .find(|&time| earliest < time && time <= event_time + 0.02)
                    .unwrap_or(event_time)
            } else {
                root_attacks
                    .iter()
                    .copied()
                    .filter(|&time| event_time - 0.18 < time && time <= event_time)
                    .last()
                    .unwrap_or(event_time)
            };
            if span.start + 0.18 < boundary
                && boundary < span.end - 0.18
                && cuts.last().is_none_or(|&last| boundary > last + 0.15)
            {
                cuts.push(boundary);
                current = Some(class);
            }
        }
        if root == anchored_root {
            cuts.extend(extension_boundaries(storage, span, &reliable));
        }
        cuts.sort_by(f64::total_cmp);
        let mut combined = Vec::new();
        for boundary in cuts {
            if span.start + 0.18 < boundary
                && boundary < span.end - 0.18
                && combined.last().is_none_or(|&last| boundary > last + 0.15)
            {
                combined.push(boundary);
            }
        }
        let mut left = span.start;
        combined.push(span.end);
        // Prefix evidence advances once across the span; repeated quality
        // changes must not rescan all preceding notes quadratically.
        let mut past_peak = [0.0f32; NOTE_COUNT];
        let mut past_onset = [0.0f32; NOTE_COUNT];
        let mut past_support = [0usize; NOTE_COUNT];
        let mut past_until = begin;
        for right in combined {
            let (lo, hi) = storage.range(left, right);
            let mut masses = [0.0f64; NOTE_COUNT];
            let mut support = [0; NOTE_COUNT];
            let mut continuation = [0; NOTE_COUNT];
            for frame in lo..hi {
                for note in 0..NOTE_COUNT {
                    let value = storage.get(frame).notes[note];
                    masses[note] += (value as f64 - 0.1).max(0.0);
                    support[note] += usize::from(value >= 0.35);
                    continuation[note] += usize::from(value >= 0.20);
                }
            }
            // Previously established thirds survive normal decay, just as
            // root/fifth notes do. Future evidence cannot establish a past third.
            for frame in past_until..lo {
                let observation = storage.get(frame);
                for note in 0..NOTE_COUNT {
                    past_peak[note] = past_peak[note].max(observation.notes[note]);
                    past_onset[note] = past_onset[note].max(observation.onsets[note]);
                    past_support[note] += usize::from(observation.notes[note] >= 0.35);
                }
            }
            past_until = lo;
            let mut chroma = [0.0; 12];
            let mut fresh_third = false;
            for note in 0..NOTE_COUNT {
                let midi = FIRST_MIDI_NOTE + note;
                let pc = midi % 12;
                let structural = pc == root || pc == (root + 7) % 12;
                let local = support[note] as f64 * NOTE_STEP >= 0.06
                    || (structural && continuation[note] as f64 * NOTE_STEP >= 0.06);
                let third = pc == (root + 3) % 12 || pc == (root + 4) % 12;
                let established_third = third
                    && credible_note(past_peak[note], past_onset[note], past_support[note])
                    && continuation[note] as f64 * NOTE_STEP >= 0.06;
                let seconds = support[note] as f64 * NOTE_STEP;
                let attack = if (third && seconds >= 0.06) || (!reliable[note] && seconds >= 0.10) {
                    note_attack_evidence(storage, lo, hi, note)
                } else {
                    AttackEvidence::default()
                };
                // Moderate evidence can contribute to the final formula, but
                // cannot establish a root or quality-change boundary. Those
                // decisions retain the stronger independent-note threshold.
                let pooled_note = reliable[note] || (seconds >= 0.10 && attack.paired >= 0.15);
                if third && pooled_note && seconds >= 0.06 {
                    fresh_third |= attack.fresh_onset >= 0.5
                        || (seconds >= 0.10 && attack.fresh_paired >= 0.15);
                }
                if (pooled_note && local) || established_third {
                    chroma[pc] += (masses[note] / (hi - lo) as f64) as f32 * treble_weight(midi);
                }
            }
            for value in &mut chroma {
                *value = value.sqrt();
            }
            normalize(&mut chroma);
            let thirds = chroma[(root + 3) % 12] + chroma[(root + 4) % 12];
            let mut best = (0, f32::NEG_INFINITY);
            for (quality, &(suffix, tones)) in QUALITIES.iter().enumerate() {
                // A freshly attacked third contradicts an absent-third label,
                // even when its brief duration gives it little whole-span mass.
                // Earlier sustained thirds do not trigger this rule: a genuine
                // third-to-fourth replacement must remain a possible suspension.
                if fresh_third && matches!(suffix, "5" | "sus2" | "sus4") {
                    continue;
                }
                let mut score = tones
                    .iter()
                    .map(|&tone| chroma[(root + tone) % 12])
                    .sum::<f32>()
                    / (tones.len() as f32).sqrt()
                    - 0.025 * tones.len().saturating_sub(3) as f32;
                if suffix == "5" {
                    score -= 0.045 + 0.15 * thirds;
                }
                if suffix == "sus2" || suffix == "sus4" {
                    score -= 0.2 * thirds;
                }
                if score >= best.1 {
                    best = (quality, score);
                }
            }
            let maximum = chroma.iter().copied().fold(0.0, f32::max);
            let known = chroma.iter().filter(|&&v| v > maximum * 0.15).count() >= 2;
            let expected = QUALITIES[best.0].1;
            let completeness = expected
                .iter()
                .filter(|&&tone| chroma[(root + tone) % 12] > maximum * 0.15)
                .count() as f32
                / expected.len() as f32;
            let confidence = if known {
                ((0.65 * span.confidence + 0.35 * best.1) * completeness).clamp(0.0, 1.0)
            } else {
                0.0
            };
            merge_segment(
                &mut result,
                Segment {
                    start: left,
                    end: right,
                    chord: if known {
                        chord_name(best.0 * 12 + root)
                    } else {
                        "N".into()
                    },
                    confidence,
                },
            );
            left = right;
        }
    }
    result
}

fn merge_segment(result: &mut Vec<Segment>, segment: Segment) {
    if let Some(previous) = result
        .last_mut()
        .filter(|previous| previous.chord == segment.chord)
    {
        let duration = previous.end - previous.start;
        let extension = segment.end - segment.start;
        previous.confidence = ((previous.confidence as f64 * duration
            + segment.confidence as f64 * extension)
            / (duration + extension)) as f32;
        previous.end = segment.end;
    } else {
        result.push(segment);
    }
}

#[cfg(test)]
#[path = "chord_decoder_tests.rs"]
mod decoder_tests;

fn estimate_key(histogram: &[f32; 12]) -> Option<String> {
    // Krumhansl–Kessler tonal profiles, correlated after mean removal.
    const MAJOR: [f32; 12] = [
        6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
    ];
    const MINOR: [f32; 12] = [
        6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
    ];
    let mean = histogram.iter().sum::<f32>() / 12.0;
    let variance = histogram.iter().map(|v| (v - mean).powi(2)).sum::<f32>();
    if variance < 1e-8 {
        return None;
    }
    let mut correlations = Vec::new();
    for index in 0..24 {
        let profile = if index < 12 { &MAJOR } else { &MINOR };
        let profile_mean = profile.iter().sum::<f32>() / 12.0;
        let norm = (variance
            * profile
                .iter()
                .map(|v| (v - profile_mean).powi(2))
                .sum::<f32>())
        .sqrt();
        let correlation = (0..12)
            .map(|pc| (histogram[(index % 12 + pc) % 12] - mean) * (profile[pc] - profile_mean))
            .sum::<f32>()
            / norm;
        correlations.push((index, correlation));
    }
    correlations.sort_by(|a, b| b.1.total_cmp(&a.1));
    if correlations[0].1 < 0.5 || correlations[0].1 - correlations[1].1 < 0.025 {
        None
    } else {
        Some(chord_name(correlations[0].0))
    }
}

fn estimate_tempo(envelope: &[f32]) -> Option<f64> {
    let rate = SAMPLE_RATE as f64 / ENVELOPE_HOP as f64;
    if envelope.len() < (rate * 8.0) as usize {
        return None;
    }
    let mut onset = vec![0.0; envelope.len()];
    for i in 2..envelope.len() {
        onset[i] =
            ((1.0 + envelope[i] * 100.0).ln() - (1.0 + envelope[i - 2] * 100.0).ln()).max(0.0);
    }
    let mean = onset.iter().sum::<f32>() / onset.len() as f32;
    if mean < 0.001 {
        return None;
    }
    for value in &mut onset {
        *value = (*value - mean).max(0.0);
    }
    let min_lag = (rate * 60.0 / 200.0).floor() as usize;
    let max_lag = (rate * 60.0 / 60.0).ceil() as usize;
    let mut autocorrelation = vec![0.0f64; max_lag + 2];
    for lag in min_lag - 1..=max_lag + 1 {
        let mut numerator = 0.0f64;
        let mut energy_a = 0.0f64;
        let mut energy_b = 0.0f64;
        for i in lag..onset.len() {
            let a = onset[i] as f64;
            let b = onset[i - lag] as f64;
            numerator += a * b;
            energy_a += a * a;
            energy_b += b * b;
        }
        autocorrelation[lag] = numerator / (energy_a * energy_b).sqrt().max(1e-10);
    }
    let peaks: Vec<usize> = (min_lag..=max_lag)
        .filter(|&lag| {
            autocorrelation[lag] > autocorrelation[lag - 1]
                && autocorrelation[lag] >= autocorrelation[lag + 1]
        })
        .collect();
    let strongest = peaks
        .iter()
        .map(|&lag| autocorrelation[lag])
        .fold(0.0, f64::max);
    // A clear pulse train repeats at every multiple of its period. Prefer its
    // first strong peak, otherwise half-time can win solely through bin rounding.
    let clear_pulse = if strongest > 0.6 {
        peaks
            .iter()
            .copied()
            .find(|&lag| autocorrelation[lag] > strongest * 0.6 && autocorrelation[lag] > 0.5)
    } else {
        None
    };
    let best = clear_pulse.or_else(|| {
        peaks.into_iter().max_by(|&a, &b| {
            // A broad log-tempo prior favors the musical pulse over half-time
            // and triplet groupings; this is an estimate, never a beat annotation.
            let prior =
                |lag: usize| (-0.8 * ((rate * 60.0 / lag as f64) / 110.0).log2().powi(2)).exp();
            (autocorrelation[a] * prior(a)).total_cmp(&(autocorrelation[b] * prior(b)))
        })
    })?;
    if autocorrelation[best] < 0.16 {
        return None;
    }
    let left = autocorrelation[best - 1];
    let center = autocorrelation[best];
    let right = autocorrelation[best + 1];
    let denominator = left - 2.0 * center + right;
    let shift = if denominator.abs() > 1e-8 {
        (0.5 * (left - right) / denominator).clamp(-0.5, 0.5)
    } else {
        0.0
    };
    let tempo = rate * 60.0 / (best as f64 + shift);
    if (60.0..=200.0).contains(&tempo) {
        Some(tempo)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analysis_json_preserves_chord_fields_and_exposes_note_event_coverage() {
        let result = Analysis {
            duration: 1.0,
            segments: vec![Segment {
                start: 0.0,
                end: 1.0,
                chord: "C".into(),
                confidence: 0.75,
            }],
            key: None,
            tempo: None,
            note_events: NoteEvents {
                events: vec![note_events::NoteEvent {
                    start: 0.125,
                    end: 0.375,
                    midi: 64,
                    note_evidence: 0.8,
                    onset_evidence: 0.9,
                }],
                truncated: false,
                coverage_end: 1.0,
            },
        };
        let json = result.json();
        assert!(json.starts_with("{\"engine\":\"chroma-v2\",\"duration\":1.000000,\"key\":null,\"tempo\":null,\"segments\":["));
        assert!(json.contains("{\"start\":0.000000,\"end\":1.000000,\"chord\":\"C\",\"confidence\":0.7500}"));
        assert!(json.contains("\"noteEventsVersion\":1,\"noteEventsLimit\":24000,\"noteEventsTruncated\":false,\"noteEventsCoverageEnd\":1.000000"));
        assert!(json.ends_with("\"noteEvents\":[{\"start\":0.125000,\"end\":0.375000,\"midi\":64,\"noteEvidence\":0.8000,\"onsetEvidence\":0.9000}]}"));
    }

    #[test]
    fn fresh_brief_thirds_survive_pooling_but_short_harmonic_blips_do_not() {
        for root in 0..12 {
            for (strength, attack, length, expect_third) in [
                (0.8f32, 0.9f32, 0.18, true),
                (0.45, 0.40, 0.16, true),
                (0.45, 0.8, 0.04, false),
            ] {
                let duration = 4.0;
                let third_begin = (1.0 / NOTE_STEP) as usize;
                let third_end = third_begin + (length / NOTE_STEP) as usize;
                let mut storage = NoteStorage::default();
                storage.extend(
                    (0..(duration / NOTE_STEP).ceil() as usize)
                        .map(|frame| {
                            let time = frame as f64 * NOTE_STEP;
                            let mut notes = [0.0; NOTE_COUNT];
                            let mut onsets = [0.0; NOTE_COUNT];
                            for midi in [36 + root, 55 + root] {
                                notes[midi - FIRST_MIDI_NOTE] = 0.8;
                                if frame == 0 {
                                    onsets[midi - FIRST_MIDI_NOTE] = 0.9;
                                }
                            }
                            let third = 52 + root - FIRST_MIDI_NOTE;
                            if (third_begin..third_end).contains(&frame) {
                                notes[third] = strength;
                            }
                            if frame == third_begin {
                                onsets[third] = attack;
                            }
                            NoteFrame {
                                time,
                                start: (time - NOTE_STEP * 0.5).max(0.0),
                                end: (time + NOTE_STEP * 0.5).min(duration),
                                notes,
                                onsets,
                            }
                        })
                        .collect(),
                );
                let state = 24 + root;
                let count = (duration * SAMPLE_RATE as f64 / HOP as f64).ceil() as usize;
                let path = vec![state; count];
                let mut score = [0.0; STATES];
                score[state] = 1.0;
                let spans = root_spans(&path, &vec![score; count], duration);
                let segments = infer_quality(&storage, &spans);
                let expected = chord_name(if expect_third { root } else { state });
                assert_eq!(segments.len(), 1, "{expected}: {segments:?}");
                assert_eq!(
                    segments[0].chord, expected,
                    "root{root}, strength{strength}, length{length}: {segments:?}"
                );
                assert_eq!(segments[0].start, 0.0);
                assert_eq!(segments[0].end, duration);
            }
        }
    }

    #[test]
    fn moderate_thirds_need_onset_aligned_note_support_in_every_key() {
        for root in 0..12 {
            for with_second in [false, true] {
                for aligned in [false, true] {
                    let duration = 4.0;
                    let note_begin = (1.0 / NOTE_STEP) as usize;
                    let note_end = note_begin + (0.16 / NOTE_STEP) as usize;
                    let onset = if aligned {
                        note_begin
                    } else {
                        (2.0 / NOTE_STEP) as usize
                    };
                    let mut storage = NoteStorage::default();
                    storage.extend(
                        (0..(duration / NOTE_STEP).ceil() as usize)
                            .map(|frame| {
                                let time = frame as f64 * NOTE_STEP;
                                let mut notes = [0.0; NOTE_COUNT];
                                let mut onsets = [0.0; NOTE_COUNT];
                                for midi in [36 + root, 55 + root] {
                                    notes[midi - FIRST_MIDI_NOTE] = 0.8;
                                    if frame == 0 {
                                        onsets[midi - FIRST_MIDI_NOTE] = 0.9;
                                    }
                                }
                                if with_second {
                                    notes[50 + root - FIRST_MIDI_NOTE] = 0.6;
                                    if frame == 0 {
                                        onsets[50 + root - FIRST_MIDI_NOTE] = 0.9;
                                    }
                                }
                                let third = 52 + root - FIRST_MIDI_NOTE;
                                if (note_begin..note_end).contains(&frame) {
                                    notes[third] = 0.45;
                                }
                                if frame == onset {
                                    onsets[third] = 0.4;
                                }
                                NoteFrame {
                                    time,
                                    start: (time - NOTE_STEP * 0.5).max(0.0),
                                    end: (time + NOTE_STEP * 0.5).min(duration),
                                    notes,
                                    onsets,
                                }
                            })
                            .collect(),
                    );
                    let span = RootSpan {
                        start: 0.0,
                        end: duration,
                        root: Some(root),
                        confidence: 1.0,
                        frame_segments: Vec::new(),
                    };
                    let segments = infer_quality(&storage, &[span]);
                    let suffix = match (aligned, with_second) {
                        (true, false) => "",
                        (true, true) => "add9",
                        (false, false) => "5",
                        (false, true) => "sus2",
                    };
                    let expected = format!("{}{}", NAMES[root], suffix);
                    assert_eq!(segments.len(), 1, "{expected}: {segments:?}");
                    assert_eq!(
                        segments[0].chord, expected,
                        "root{root}, aligned{aligned}, second{with_second}: {segments:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn a_weak_previous_fourth_does_not_split_delayed_suspension_completion() {
        for root in 0..12 {
            let duration = 5.0;
            let span_start = 1.0;
            let delayed_second = (1.9 / NOTE_STEP) as usize;
            let mut storage = NoteStorage::default();
            storage.extend(
                (0..(duration / NOTE_STEP).ceil() as usize)
                    .map(|frame| {
                        let time = frame as f64 * NOTE_STEP;
                        let mut notes = [0.0; NOTE_COUNT];
                        let mut onsets = [0.0; NOTE_COUNT];
                        if time >= span_start {
                            for midi in [36 + root, 55 + root] {
                                notes[midi - FIRST_MIDI_NOTE] = 0.8;
                            }
                        }
                        // A moderate tail from the preceding harmony overlaps
                        // the new root's first notes, then finishes decaying.
                        let fourth = 53 + root - FIRST_MIDI_NOTE;
                        if time < 1.12 {
                            notes[fourth] = 0.55;
                        } else if time < 1.25 {
                            notes[fourth] = 0.2;
                        }
                        if frame == (0.94 / NOTE_STEP) as usize {
                            onsets[fourth] = 0.4;
                        }
                        let second = 50 + root - FIRST_MIDI_NOTE;
                        if frame >= delayed_second {
                            notes[second] = 0.75;
                        }
                        if frame == delayed_second {
                            onsets[second] = 0.9;
                        }
                        NoteFrame {
                            time,
                            start: (time - NOTE_STEP * 0.5).max(0.0),
                            end: (time + NOTE_STEP * 0.5).min(duration),
                            notes,
                            onsets,
                        }
                    })
                    .collect(),
            );
            let span = RootSpan {
                start: span_start,
                end: duration,
                root: Some(root),
                confidence: 1.0,
                frame_segments: Vec::new(),
            };
            let segments = infer_quality(&storage, &[span]);
            let expected = format!("{}sus2", NAMES[root]);
            assert_eq!(segments.len(), 1, "{expected}: {segments:?}");
            assert_eq!(segments[0].chord, expected);
            assert_eq!(segments[0].start, span_start);
            assert_eq!(segments[0].end, duration);
        }
    }

    #[test]
    fn grouped_viterbi_matches_exhaustive_transitions_including_ties() {
        let mut seed = 0x6a91_35f2u32;
        for tied in [true, false] {
            let scores: Vec<[f32; STATES]> = (0..48)
                .map(|_| {
                    std::array::from_fn(|_| {
                        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                        if tied {
                            0.0
                        } else {
                            ((seed >> 16) % 17) as f32 / 16.0
                        }
                    })
                })
                .collect();
            let mut previous = scores[0].map(f64::from);
            let mut back = vec![[0usize; STATES]; scores.len()];
            for i in 1..scores.len() {
                let mut next = [0.0; STATES];
                for state in 0..STATES {
                    let mut best = f64::NEG_INFINITY;
                    for parent in 0..STATES {
                        let penalty = if parent == state {
                            0.0
                        } else if parent == UNKNOWN || state == UNKNOWN {
                            0.85 * 0.47
                        } else if parent % 12 == state % 12 {
                            0.85 * 0.8
                        } else {
                            0.85
                        };
                        let candidate = previous[parent] - penalty;
                        if candidate > best {
                            best = candidate;
                            back[i][state] = parent;
                        }
                    }
                    next[state] = best + scores[i][state] as f64;
                }
                let maximum = next.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                for value in &mut next {
                    *value -= maximum;
                }
                previous = next;
            }
            let mut final_state = 0;
            for state in 1..STATES {
                if previous[state] > previous[final_state] {
                    final_state = state;
                }
            }
            let mut expected = vec![0; scores.len()];
            expected[scores.len() - 1] = final_state;
            for i in (1..scores.len()).rev() {
                expected[i - 1] = back[i][expected[i]];
            }
            assert_eq!(smooth_path(&scores), expected, "tied={tied}");
        }
    }

    fn chord(root: usize, minor: bool, seconds: f64, cents: f64) -> Vec<i16> {
        let notes = [root + 48, root + 48 + if minor { 3 } else { 4 }, root + 55];
        (0..(seconds * SAMPLE_RATE as f64) as usize)
            .map(|i| {
                let t = i as f64 / SAMPLE_RATE as f64;
                let value: f64 = notes
                    .iter()
                    .map(|&midi| {
                        let frequency =
                            440.0 * 2.0f64.powf((midi as f64 - 69.0 + cents / 100.0) / 12.0);
                        (1..=5)
                            .map(|harmonic| {
                                (std::f64::consts::TAU * frequency * harmonic as f64 * t).sin()
                                    / (harmonic * harmonic) as f64
                            })
                            .sum::<f64>()
                    })
                    .sum();
                (value * 5000.0) as i16
            })
            .collect()
    }

    fn normalized_pcm(values: &[f64]) -> Vec<i16> {
        let peak = values.iter().map(|x| x.abs()).fold(0.0, f64::max);
        values
            .iter()
            .map(|x| (x * 24575.0 / peak.max(1e-9)) as i16)
            .collect()
    }

    fn plucked_arpeggio(root: usize, minor: bool, decay: f64) -> Vec<i16> {
        let third = if minor { 3 } else { 4 };
        let notes = [0, 7, 12, third + 12, 19, 24, 19, third + 12];
        let mut samples = vec![0.0; SAMPLE_RATE * 6];
        // The first identifying third arrives 1.5 s after the bass note.
        for pluck in 0..12 {
            let start = pluck * SAMPLE_RATE / 2;
            let frequency =
                440.0 * 2.0f64.powf((root + 36 + notes[pluck % 8]) as f64 / 12.0 - 69.0 / 12.0);
            for (i, sample) in samples[start..]
                .iter_mut()
                .take((8.0 * decay * SAMPLE_RATE as f64) as usize)
                .enumerate()
            {
                let t = i as f64 / SAMPLE_RATE as f64;
                let envelope = (t / 0.004).min(1.0) * (-t / decay).exp();
                *sample += envelope
                    * (1..=5)
                        .map(|h| {
                            (std::f64::consts::TAU * frequency * h as f64 * t).sin()
                                / (h as f64).powf(1.3)
                        })
                        .sum::<f64>();
            }
        }
        normalized_pcm(&samples)
    }

    fn correct_duration(pcm: &[i16], expected: &str) -> (f64, Vec<Segment>) {
        let mut analyzer = ChordAnalyzer::new();
        analyzer.push(pcm).unwrap();
        let result = analyzer.finish().unwrap();
        let correct = result
            .segments
            .iter()
            .filter(|s| s.chord == expected)
            .map(|s| s.end - s.start)
            .sum();
        (correct, result.segments)
    }

    #[test]
    fn major_and_minor_plucked_arpeggios_keep_the_delayed_third() {
        for root in 0..12 {
            for minor in [false, true] {
                for decay in [0.15, 0.4] {
                    let expected = chord_name(root + if minor { 12 } else { 0 });
                    let (correct, segments) =
                        correct_duration(&plucked_arpeggio(root, minor, decay), &expected);
                    assert!(correct > 5.4, "{expected}, decay {decay}: {segments:?}");
                }
            }
        }
    }

    #[test]
    fn wide_and_inverted_triads_retain_independently_played_thirds() {
        let mut failures = Vec::new();
        for root in 0..12 {
            for minor in [false, true] {
                let third = if minor { 3 } else { 4 };
                // A high major third lies near the bass's fifth harmonic.
                // First/second inversions also guard against forcing bass=root.
                for notes in [[0, 7, third + 24], [third, 12, 19], [7, 12, third + 12]] {
                    for bass_gain in [1.0, 2.0] {
                        let samples: Vec<f64> = (0..SAMPLE_RATE * 3)
                            .map(|i| {
                                let t = i as f64 / SAMPLE_RATE as f64;
                                let envelope = (t / 0.006).min(1.0) * ((3.0 - t) / 0.05).min(1.0);
                                envelope
                                    * notes
                                        .iter()
                                        .enumerate()
                                        .map(|(voice, &note)| {
                                            let frequency = 440.0
                                                * 2.0f64.powf(
                                                    (root + 36 + note) as f64 / 12.0 - 69.0 / 12.0,
                                                );
                                            let gain = if voice == 0 { bass_gain } else { 1.0 };
                                            gain * (1..=6)
                                                .map(|h| {
                                                    (std::f64::consts::TAU
                                                        * frequency
                                                        * h as f64
                                                        * t
                                                        + (voice * h) as f64 * 0.73)
                                                        .sin()
                                                        / (h as f64).powf(1.3)
                                                })
                                                .sum::<f64>()
                                        })
                                        .sum::<f64>()
                            })
                            .collect();
                        let expected = chord_name(root + if minor { 12 } else { 0 });
                        let (correct, segments) =
                            correct_duration(&normalized_pcm(&samples), &expected);
                        if correct <= 2.7 {
                            failures.push(format!(
                                "{expected}, notes {notes:?}, bass {bass_gain}: {segments:?}"
                            ));
                        }
                    }
                }
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn all_major_and_minor_triads_are_identified() {
        for index in 0..24 {
            let mut analyzer = ChordAnalyzer::new();
            analyzer
                .push(&chord(index % 12, index >= 12, 1.5, 0.0))
                .unwrap();
            let result = analyzer.finish().unwrap();
            let expected = chord_name(index);
            let correct: f64 = result
                .segments
                .iter()
                .filter(|s| s.chord == expected)
                .map(|s| s.end - s.start)
                .sum();
            assert!(correct > 1.2, "{expected}: {:?}", result.segments);
        }
    }

    #[test]
    fn chunking_does_not_change_results_and_timeline_covers_the_file() {
        let mut pcm = vec![0; SAMPLE_RATE];
        for (root, minor) in [(0, false), (7, false), (9, true), (5, false)] {
            pcm.extend(chord(root, minor, 2.0, 0.0));
        }
        pcm.extend(vec![0; SAMPLE_RATE]);
        let mut whole = ChordAnalyzer::new();
        whole.push(&pcm).unwrap();
        let result = whole.finish().unwrap();
        let mut streamed = ChordAnalyzer::new();
        for chunk in pcm.chunks(317) {
            streamed.push(chunk).unwrap();
        }
        assert_eq!(result.json(), streamed.finish().unwrap().json());
        assert_eq!(result.segments[0].start, 0.0);
        assert_eq!(result.segments.last().unwrap().end, 10.0);
        for pair in result.segments.windows(2) {
            assert_eq!(pair[0].end, pair[1].start);
        }
        assert_eq!(result.segments.first().unwrap().chord, "N");
        assert_eq!(result.segments.last().unwrap().chord, "N");
        for label in ["C", "G", "Am", "F"] {
            assert!(
                result.segments.iter().any(|s| s.chord == label),
                "{label}: {:?}",
                result.segments
            );
        }
        assert_eq!(streamed.push(&[0]), Err("AnalysisFinished"));
        assert_eq!(streamed.finish().unwrap_err(), "AnalysisFinished");
    }

    #[test]
    fn silence_noise_and_single_notes_do_not_become_chords() {
        let mut seed = 17u32;
        let noise: Vec<i16> = (0..SAMPLE_RATE * 2)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                (seed >> 16) as i16 / 3
            })
            .collect();
        let tone: Vec<i16> = (0..SAMPLE_RATE * 2)
            .map(|i| {
                (12000.0 * (std::f64::consts::TAU * 220.0 * i as f64 / SAMPLE_RATE as f64).sin())
                    as i16
            })
            .collect();
        for pcm in [vec![0; SAMPLE_RATE * 2], noise, tone] {
            let mut analyzer = ChordAnalyzer::new();
            analyzer.push(&pcm).unwrap();
            let result = analyzer.finish().unwrap();
            assert!(
                result.segments.iter().all(|s| s.chord == "N"),
                "{:?}",
                result.segments
            );
            assert_eq!(result.key, None);
            assert_eq!(result.tempo, None);
        }
    }

    #[test]
    fn slight_detuning_is_tolerated() {
        for cents in [-30.0, 30.0] {
            let mut analyzer = ChordAnalyzer::new();
            analyzer.push(&chord(9, true, 2.0, cents)).unwrap();
            let result = analyzer.finish().unwrap();
            assert!(
                result
                    .segments
                    .iter()
                    .filter(|s| s.chord == "Am")
                    .map(|s| s.end - s.start)
                    .sum::<f64>()
                    > 1.5,
                "{:?}",
                result.segments
            );
        }
    }

    #[test]
    fn invalid_lengths_are_rejected_without_truncation() {
        let mut analyzer = ChordAnalyzer::new();
        analyzer.push(&[0; 20]).unwrap();
        assert_eq!(analyzer.finish().unwrap_err(), "AudioTooShort");
        analyzer.samples = MAX_SAMPLES;
        assert_eq!(analyzer.push(&[0]), Err("AudioTooLong"));
    }

    #[test]
    fn periodic_strums_have_their_pulse_tempo() {
        for bpm in [75.0, 98.0, 120.0, 160.0, 195.0] {
            let envelope: Vec<f32> = (0..1500)
                .map(|i| {
                    let phase = ((i as f64 * ENVELOPE_HOP as f64 / SAMPLE_RATE as f64) * bpm
                        / 60.0)
                        .fract();
                    (0.2 * (-phase * 10.0).exp()) as f32
                })
                .collect();
            let estimated = estimate_tempo(&envelope).expect("periodic strum pulse");
            assert!((estimated - bpm).abs() < 3.0, "{bpm}: {estimated}");
        }
        assert_eq!(estimate_tempo(&vec![0.1; 1500]), None);
    }
}
