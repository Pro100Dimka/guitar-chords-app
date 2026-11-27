//! Sparse, audio-derived note events, separate from the chord decoder.
//!
//! These are estimated pitch activity and attacks, not instrument, fingering,
//! velocity, or picking-direction labels. All windows use source-frame seconds:
//! the Basic Pitch window seams do not have a uniform frame hop.
use crate::chord_notes::{NoteFrame, FIRST_MIDI_NOTE, NOTE_COUNT};
use std::cmp::Ordering;
use std::collections::BinaryHeap;

pub const NOTE_EVENTS_VERSION: usize = 1;
pub const MAX_NOTE_EVENTS: usize = 24_000;
const ACTIVITY_START: f32 = 0.35;
const ACTIVITY_END: f32 = 0.20;
const STRONG_ACTIVITY: f32 = 0.65;
const STRONG_ONSET: f32 = 0.50;
const MIN_SUPPORT_SECONDS: f64 = 0.06;
const RELEASE_SECONDS: f64 = 0.05;
const ONSET_PAIR_RADIUS: f64 = 0.06;
const ONSET_SUPPORT_WINDOW: f64 = 0.18;
const MIN_ATTACK_SEPARATION: f64 = 0.06;
const TIME_EPSILON: f64 = 1e-9;

#[derive(Debug, Clone)]
pub struct NoteEvent {
    pub start: f64,
    pub end: f64,
    pub midi: usize,
    /// Peak note-head activation in this event, not a probability or velocity.
    pub note_evidence: f32,
    /// The confirmed onset peak at the start; zero for activity-only events.
    pub onset_evidence: f32,
}

#[derive(Debug, Clone)]
pub struct NoteEvents {
    pub events: Vec<NoteEvent>,
    pub truncated: bool,
    /// All accepted attacks strictly before this time are retained. When not
    /// truncated, coverage reaches duration. This does not assert note accuracy.
    pub coverage_end: f64,
}

pub(crate) trait NoteFrames {
    fn len(&self) -> usize;
    fn frame(&self, index: usize) -> &NoteFrame;
}

fn rounded_time(time: f64) -> f64 {
    // Match Analysis::json exactly, including half-microsecond ties. Rounding
    // time*1e6 separately can disagree with float formatting at those boundaries.
    format!("{time:.6}")
        .parse()
        .expect("a formatted floating-point timestamp remains parseable")
}

fn event_order(a: &NoteEvent, b: &NoteEvent) -> Ordering {
    a.start
        .total_cmp(&b.start)
        .then(a.midi.cmp(&b.midi))
        .then(a.end.total_cmp(&b.end))
}

// A max heap retains the earliest events even though pitches are decoded one at
// a time. A per-pitch quota or stopping at the first full buffer would favor bass.
struct HeapEvent(NoteEvent);

impl PartialEq for HeapEvent {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for HeapEvent {}
impl PartialOrd for HeapEvent {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for HeapEvent {
    fn cmp(&self, other: &Self) -> Ordering {
        event_order(&self.0, &other.0)
    }
}

struct EventCollector {
    heap: BinaryHeap<HeapEvent>,
    limit: usize,
    duration: f64,
    first_dropped_start: Option<f64>,
}

impl EventCollector {
    fn new(limit: usize, duration: f64) -> Self {
        Self {
            heap: BinaryHeap::new(),
            limit,
            duration: rounded_time(duration),
            first_dropped_start: None,
        }
    }

    fn dropped(&mut self, start: f64) {
        self.first_dropped_start = Some(
            self.first_dropped_start
                .map_or(start, |previous| previous.min(start)),
        );
    }

    fn push(&mut self, mut event: NoteEvent) {
        event.start = rounded_time(event.start).clamp(0.0, self.duration);
        event.end = rounded_time(event.end).clamp(0.0, self.duration);
        // Validate after rounding, using the exact values subsequently written
        // to JSON. In particular, never serialize a zero-duration interval.
        if !event.start.is_finite()
            || !event.end.is_finite()
            || event.end <= event.start
        {
            return;
        }
        if self.heap.len() < self.limit {
            self.heap.push(HeapEvent(event));
            return;
        }
        if self
            .heap
            .peek()
            .is_some_and(|last| event_order(&event, &last.0) == Ordering::Less)
        {
            let displaced = self.heap.pop().unwrap().0;
            self.dropped(displaced.start);
            self.heap.push(HeapEvent(event));
        } else {
            self.dropped(event.start);
        }
    }

    fn finish(self) -> NoteEvents {
        let mut events: Vec<NoteEvent> = self.heap.into_iter().map(|event| event.0).collect();
        events.sort_by(event_order);
        NoteEvents {
            events,
            truncated: self.first_dropped_start.is_some(),
            coverage_end: self.first_dropped_start.unwrap_or(self.duration),
        }
    }
}

/// Index of the first observation whose coverage may intersect `start`.
fn first_overlapping(source: &impl NoteFrames, start: f64) -> usize {
    let (mut lo, mut hi) = (0, source.len());
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if source.frame(mid).end <= start {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo
}

fn evidence(source: &impl NoteFrames, note: usize, start: f64, end: f64) -> (f32, f64) {
    if end <= start {
        return (0.0, 0.0);
    }
    let mut peak = 0.0f32;
    let mut supported_seconds = 0.0;
    for index in first_overlapping(source, start)..source.len() {
        let frame = source.frame(index);
        if frame.start >= end {
            break;
        }
        let overlap = (frame.end.min(end) - frame.start.max(start)).max(0.0);
        if overlap > 0.0 {
            peak = peak.max(frame.notes[note]);
            if frame.notes[note] >= ACTIVITY_START {
                supported_seconds += overlap;
            }
        }
    }
    (peak, supported_seconds)
}

fn emit_interval(
    source: &impl NoteFrames,
    note: usize,
    start: f64,
    end: f64,
    onset_evidence: f32,
    output: &mut EventCollector,
) {
    let (note_evidence, support) = evidence(source, note, start, end);
    if support + TIME_EPSILON >= MIN_SUPPORT_SECONDS
        && (onset_evidence >= STRONG_ONSET || note_evidence >= STRONG_ACTIVITY)
    {
        output.push(NoteEvent {
            start,
            end,
            midi: FIRST_MIDI_NOTE + note,
            note_evidence,
            onset_evidence,
        });
    }
}

fn decode_activity_run(
    source: &impl NoteFrames,
    note: usize,
    first: usize,
    previous_end: f64,
    end: f64,
    output: &mut EventCollector,
) {
    let start = source.frame(first).start.max(previous_end);
    if end <= start {
        return;
    }
    // The onset head may lead the frame head. Keep the lead bounded and never
    // move an event into a preceding activity run of the same pitch.
    let search_start = (start - ONSET_PAIR_RADIUS).max(previous_end).max(0.0);
    let mut attacks: Vec<(f64, f32)> = Vec::new();
    for index in first_overlapping(source, search_start)..source.len() {
        let frame = source.frame(index);
        if frame.time >= end {
            break;
        }
        if frame.time < search_start {
            continue;
        }
        let value = frame.onsets[note];
        let before = if index > 0 {
            source.frame(index - 1).onsets[note]
        } else {
            0.0
        };
        // Select the leading frame of a flat maximum, not every plateau frame.
        if value < STRONG_ONSET || value <= before {
            continue;
        }
        // A flat shelf can still rise to a higher peak. Inspect its far edge
        // before accepting the leading frame; only that frame scans the shelf.
        let mut following = index + 1;
        while following < source.len() && source.frame(following).onsets[note] == value {
            following += 1;
        }
        if following < source.len() && source.frame(following).onsets[note] > value {
            continue;
        }
        let (nearby_note, _) = evidence(
            source,
            note,
            (frame.time - ONSET_PAIR_RADIUS).max(start),
            (frame.time + ONSET_PAIR_RADIUS).min(end),
        );
        let (_, future_support) = evidence(
            source,
            note,
            frame.time.max(start),
            (frame.time + ONSET_SUPPORT_WINDOW).min(end),
        );
        if nearby_note < ACTIVITY_START
            || future_support + TIME_EPSILON < MIN_SUPPORT_SECONDS
        {
            continue;
        }
        if let Some(last) = attacks.last_mut() {
            if frame.time - last.0 + TIME_EPSILON < MIN_ATTACK_SEPARATION {
                if value > last.1 {
                    *last = (frame.time, value);
                }
                continue;
            }
        }
        attacks.push((frame.time, value));
    }
    if attacks.is_empty() {
        emit_interval(source, note, start, end, 0.0, output);
        return;
    }
    // A late confirmed reattack must not erase an earlier strong sustained
    // note. An activity-only prefix has onsetEvidence=0, not a fabricated attack.
    if attacks[0].0 > start {
        emit_interval(source, note, start, attacks[0].0, 0.0, output);
    }
    for (index, &(attack, strength)) in attacks.iter().enumerate() {
        let next = attacks.get(index + 1).map_or(end, |event| event.0);
        emit_interval(source, note, attack, next, strength, output);
    }
}

pub(crate) fn decode(source: &impl NoteFrames, duration: f64) -> NoteEvents {
    decode_with_limit(source, duration, MAX_NOTE_EVENTS)
}

fn decode_with_limit(source: &impl NoteFrames, duration: f64, limit: usize) -> NoteEvents {
    let mut output = EventCollector::new(limit, duration);
    for note in 0..NOTE_COUNT {
        let mut first = None;
        let mut release = None;
        let mut previous_end = 0.0;
        for index in 0..source.len() {
            let frame = source.frame(index);
            if first.is_none() {
                if frame.notes[note] >= ACTIVITY_START {
                    first = Some(index);
                } else {
                    continue;
                }
            }
            if frame.notes[note] < ACTIVITY_END {
                let release_index = *release.get_or_insert(index);
                let release_start = source.frame(release_index).start;
                if frame.end - release_start + TIME_EPSILON >= RELEASE_SECONDS {
                    decode_activity_run(
                        source,
                        note,
                        first.take().unwrap(),
                        previous_end,
                        release_start.min(duration),
                        &mut output,
                    );
                    previous_end = release_start;
                    release = None;
                }
            } else {
                release = None;
            }
        }
        if let Some(first) = first {
            decode_activity_run(source, note, first, previous_end, duration, &mut output);
        }
    }
    output.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    impl NoteFrames for Vec<NoteFrame> {
        fn len(&self) -> usize {
            Vec::len(self)
        }
        fn frame(&self, index: usize) -> &NoteFrame {
            &self[index]
        }
    }

    fn frames(count: usize) -> Vec<NoteFrame> {
        (0..count)
            .map(|index| NoteFrame {
                time: index as f64 * 0.01 + 0.005,
                start: index as f64 * 0.01,
                end: (index + 1) as f64 * 0.01,
                notes: [0.0; NOTE_COUNT],
                onsets: [0.0; NOTE_COUNT],
            })
            .collect()
    }

    fn activate(frames: &mut [NoteFrame], midi: usize, first: usize, end: usize, value: f32) {
        for frame in &mut frames[first..end] {
            frame.notes[midi - FIRST_MIDI_NOTE] = value;
        }
    }

    #[test]
    fn empty_and_silent_frames_report_complete_coverage() {
        for input in [Vec::new(), frames(100)] {
            let result = decode(&input, 1.0);
            assert!(result.events.is_empty());
            assert!(!result.truncated);
            assert_eq!(result.coverage_end, 1.0);
        }
    }

    #[test]
    fn repeated_attacks_split_a_sustained_pitch_without_overlapping() {
        let mut input = frames(100);
        activate(&mut input, 64, 10, 80, 0.8);
        input[10].onsets[64 - FIRST_MIDI_NOTE] = 0.9;
        input[40].onsets[64 - FIRST_MIDI_NOTE] = 0.7;
        let result = decode(&input, 1.0);
        assert_eq!(result.events.len(), 2);
        assert_eq!((result.events[0].start, result.events[0].end), (0.105, 0.405));
        assert_eq!((result.events[1].start, result.events[1].end), (0.405, 0.8));
        assert!(result.events.iter().all(|event| event.midi == 64));
        assert_eq!(result.events[0].onset_evidence, 0.9);
        assert_eq!(result.events[1].onset_evidence, 0.7);
    }

    #[test]
    fn short_activity_dropout_is_bridged_but_a_stable_release_separates_notes() {
        let mut input = frames(100);
        activate(&mut input, 52, 5, 25, 0.8);
        activate(&mut input, 52, 28, 50, 0.8);
        activate(&mut input, 52, 60, 80, 0.8);
        let result = decode(&input, 1.0);
        assert_eq!(result.events.len(), 2);
        assert_eq!((result.events[0].start, result.events[0].end), (0.05, 0.5));
        assert_eq!((result.events[1].start, result.events[1].end), (0.6, 0.8));
        assert!(result.events.iter().all(|event| event.onset_evidence == 0.0));
    }

    #[test]
    fn unsupported_onsets_and_short_note_spikes_are_not_events() {
        let mut input = frames(100);
        input[20].onsets[60 - FIRST_MIDI_NOTE] = 0.95;
        activate(&mut input, 64, 30, 34, 0.9);
        activate(&mut input, 67, 50, 80, 0.4);
        assert!(decode(&input, 1.0).events.is_empty());
    }

    #[test]
    fn onset_may_lead_note_activity_and_a_plateau_is_only_one_attack() {
        let mut input = frames(100);
        activate(&mut input, 60, 10, 60, 0.45);
        for frame in &mut input[6..10] {
            frame.onsets[60 - FIRST_MIDI_NOTE] = 0.8;
        }
        let result = decode(&input, 1.0);
        assert_eq!(result.events.len(), 1);
        assert_eq!((result.events[0].start, result.events[0].end), (0.065, 0.6));
        assert_eq!(result.events[0].note_evidence, 0.45);
        assert_eq!(result.events[0].onset_evidence, 0.8);
    }

    #[test]
    fn an_ascending_onset_shelf_is_not_a_separate_attack() {
        let mut input = frames(100);
        activate(&mut input, 60, 10, 60, 0.45);
        for frame in &mut input[10..20] {
            frame.onsets[60 - FIRST_MIDI_NOTE] = 0.7;
        }
        input[20].onsets[60 - FIRST_MIDI_NOTE] = 0.9;
        let result = decode(&input, 1.0);
        assert_eq!(result.events.len(), 1);
        assert_eq!((result.events[0].start, result.events[0].end), (0.205, 0.6));
        assert_eq!(result.events[0].onset_evidence, 0.9);
    }

    #[test]
    fn a_dip_separates_flat_onset_maxima_and_preserves_their_leading_times() {
        let mut input = frames(100);
        activate(&mut input, 60, 10, 80, 0.45);
        for frame in &mut input[10..20] {
            frame.onsets[60 - FIRST_MIDI_NOTE] = 0.7;
        }
        for frame in &mut input[22..32] {
            frame.onsets[60 - FIRST_MIDI_NOTE] = 0.9;
        }
        let result = decode(&input, 1.0);
        assert_eq!(result.events.len(), 2);
        assert_eq!((result.events[0].start, result.events[0].end), (0.105, 0.225));
        assert_eq!((result.events[1].start, result.events[1].end), (0.225, 0.8));
        assert_eq!(result.events[0].onset_evidence, 0.7);
        assert_eq!(result.events[1].onset_evidence, 0.9);
    }

    #[test]
    fn a_final_onset_plateau_keeps_its_leading_time() {
        let mut input = frames(100);
        activate(&mut input, 60, 10, 100, 0.45);
        for frame in &mut input[90..100] {
            frame.onsets[60 - FIRST_MIDI_NOTE] = 0.8;
        }
        let result = decode(&input, 1.0);
        assert_eq!(result.events.len(), 1);
        assert_eq!((result.events[0].start, result.events[0].end), (0.905, 1.0));
        assert_eq!(result.events[0].onset_evidence, 0.8);
    }

    #[test]
    fn nonuniform_frame_coverage_controls_support_and_tail_duration() {
        let midi = 57;
        let mut input = vec![
            NoteFrame { time: 0.01, start: 0.0, end: 0.02, notes: [0.0; NOTE_COUNT], onsets: [0.0; NOTE_COUNT] },
            NoteFrame { time: 0.035, start: 0.02, end: 0.05, notes: [0.0; NOTE_COUNT], onsets: [0.0; NOTE_COUNT] },
            NoteFrame { time: 0.07, start: 0.05, end: 0.09, notes: [0.0; NOTE_COUNT], onsets: [0.0; NOTE_COUNT] },
        ];
        activate(&mut input, midi, 0, 3, 0.8);
        let result = decode(&input, 0.09);
        assert_eq!(result.events.len(), 1, "Three frames can cover more than 60ms");
        assert_eq!((result.events[0].start, result.events[0].end), (0.0, 0.09));
        assert_eq!(result.coverage_end, 0.09);
    }

    #[test]
    fn attack_times_follow_the_actual_model_window_seam() {
        let centers = [1.55, 1.57, 1.59, 1.61, 1.636, 1.6390839002, 1.6506938776, 1.67, 1.69, 1.71, 1.73, 1.75];
        let mut input: Vec<NoteFrame> = centers.iter().enumerate().map(|(index, &time)| NoteFrame {
            time,
            start: if index == 0 { 1.54 } else { (centers[index - 1] + time) * 0.5 },
            end: centers.get(index + 1).map_or(1.76, |&next| (time + next) * 0.5),
            notes: [0.0; NOTE_COUNT],
            onsets: [0.0; NOTE_COUNT],
        }).collect();
        activate(&mut input, 64, 0, centers.len(), 0.8);
        input[5].onsets[64 - FIRST_MIDI_NOTE] = 0.9;
        let result = decode(&input, 1.76);
        assert_eq!(result.events.len(), 2); // activity-only prefix and actual reattack
        assert_eq!(result.events[1].start, 1.639084);
        assert_eq!(result.events[1].end, 1.76);
        assert_eq!(result.events[0].end, result.events[1].start);
    }

    #[test]
    fn cap_keeps_earliest_events_across_pitches_and_reports_dropped_boundary() {
        let mut input = frames(100);
        // Lower pitches are scanned first, but may not consume an early-event quota.
        activate(&mut input, 40, 60, 80, 0.8);
        activate(&mut input, 76, 10, 25, 0.8);
        activate(&mut input, 76, 35, 50, 0.8);
        let result = decode_with_limit(&input, 1.0, 2);
        assert_eq!(result.events.len(), 2);
        assert!(result.events.iter().all(|event| event.midi == 76));
        assert_eq!(result.coverage_end, 0.6);
        assert!(result.truncated);
    }

    #[test]
    fn simultaneous_events_sort_by_midi_and_truncation_does_not_claim_whole_onset() {
        let mut input = frames(100);
        activate(&mut input, 40, 10, 40, 0.8);
        activate(&mut input, 64, 10, 40, 0.8);
        let complete = decode(&input, 1.0);
        assert_eq!(complete.events.iter().map(|event| event.midi).collect::<Vec<_>>(), vec![40, 64]);
        let partial = decode_with_limit(&input, 1.0, 1);
        assert_eq!(partial.coverage_end, 0.1);
        assert_eq!(partial.events[0].start, partial.coverage_end);
        assert!(partial.truncated);
    }

    #[test]
    fn json_rounding_never_retains_an_empty_interval() {
        let mut output = EventCollector::new(1, 1.0000004);
        output.push(NoteEvent { start: 0.2000001, end: 0.2000002, midi: 60, note_evidence: 0.8, onset_evidence: 0.8 });
        let result = output.finish();
        assert!(result.events.is_empty());
        assert!(!result.truncated);
        assert_eq!(result.coverage_end, 1.0);
    }

    #[test]
    fn full_coverage_uses_the_same_rounding_as_the_existing_duration_field() {
        // This PCM duration is exactly representable and lands on a decimal tie.
        let duration = 16_125.0 / 16_000.0;
        let result = EventCollector::new(1, duration).finish();
        assert_eq!(
            format!("{:.6}", result.coverage_end),
            format!("{duration:.6}")
        );
    }
}
