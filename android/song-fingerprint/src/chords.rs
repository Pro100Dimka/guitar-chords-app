//! Small, streaming, on-device major/minor chord estimator.
//!
//! 16 kHz mono PCM -> spectral peaks -> chroma -> temporally smoothed templates.
//! No learned weights, network, or song catalogue. Confidence is a heuristic, not
//! a probability. Extended chords are reduced to a triad; melody is not lyrics.
use chfft::RFft1D;
use std::f32::consts::PI;
use std::fmt::Write;

pub const SAMPLE_RATE: usize = 16_000;
pub const MAX_SAMPLES: usize = SAMPLE_RATE * 900;
const WINDOW: usize = 8192;
const HOP: usize = 1024;
const CONTEXT_RADIUS: usize = 8;
const ENVELOPE_HOP: usize = 256;
const UNKNOWN: usize = 24;
const NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

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
}

impl Analysis {
    // Labels are entirely internal ASCII; there is no file name/user text here.
    pub fn json(&self) -> String {
        let mut out = format!(
            "{{\"engine\":\"chroma-v1\",\"duration\":{:.6},\"key\":",
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
        out.push_str("]}");
        out
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
}

impl Default for ChordAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

impl ChordAnalyzer {
    pub fn new() -> Self {
        Self {
            fft: RFft1D::new(WINDOW),
            window: (0..WINDOW)
                .map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / WINDOW as f32).cos())
                .collect(),
            // Center the first analysis frame on t=0, including the first note.
            pending: vec![0.0; WINDOW / 2],
            frames: Vec::new(),
            envelope: Vec::new(),
            energy: 0.0,
            energy_count: 0,
            samples: 0,
            finished: false,
        }
    }

    pub fn push(&mut self, pcm: &[i16]) -> Result<(), &'static str> {
        if self.finished {
            return Err("AnalysisFinished");
        }
        if pcm.len() > MAX_SAMPLES.saturating_sub(self.samples) {
            return Err("AudioTooLong");
        }
        // Bound temporary PCM independently of how a caller partitions input.
        for chunk in pcm.chunks(16_384) {
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
            let magnitudes: Vec<f32> = spectrum.iter().map(|z| z.norm()).collect();
            let (chroma, bass, tonal) = pitch_classes(&magnitudes);
            self.frames.push(Feature {
                chroma,
                bass,
                rms,
                tonal,
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
        // Pad only analysis context: reported duration is the real decoded PCM.
        self.pending.resize(self.pending.len() + WINDOW / 2, 0.0);
        self.extract();
        self.frames.truncate(self.samples.div_ceil(HOP));
        let duration = self.samples as f64 / SAMPLE_RATE as f64;
        let peak_rms = self.frames.iter().map(|x| x.rms).fold(0.0, f32::max);
        let silence = (peak_rms * 0.008).max(0.0003);
        let mut scores = Vec::with_capacity(self.frames.len());
        let mut histogram = [0.0; 12];
        let mut musical_frames = 0;
        for (index, feature) in self.frames.iter().enumerate() {
            let mut chroma = [0.0; 12];
            let mut bass = [0.0; 12];
            // Average neighboring arpeggio notes as well as strum transients.
            // The 512 ms radius does not assume a beat grid or song key.
            for neighbor in index.saturating_sub(CONTEXT_RADIUS)
                ..=(index + CONTEXT_RADIUS).min(self.frames.len() - 1)
            {
                let weight = (CONTEXT_RADIUS + 1 - neighbor.abs_diff(index)) as f32;
                for pc in 0..12 {
                    chroma[pc] += self.frames[neighbor].chroma[pc] * weight;
                    bass[pc] += self.frames[neighbor].bass[pc] * weight;
                }
            }
            normalize(&mut chroma);
            normalize(&mut bass);
            let mut emission = chord_scores(&chroma, &bass);
            let maximum = emission[..24].iter().copied().fold(0.0, f32::max);
            let largest = chroma.iter().copied().fold(0.0, f32::max);
            let notes = chroma.iter().filter(|&&v| v > largest * 0.22).count();
            // No confidence invented for silence, broad noise, or a single note.
            if feature.rms < silence || feature.tonal < 0.60 || notes < 2 || maximum < 0.60 {
                emission.fill(-2.0);
                emission[UNKNOWN] = 1.0;
            } else {
                emission[UNKNOWN] = if notes < 3 { 0.72 } else { 0.40 };
                for pc in 0..12 {
                    histogram[pc] += chroma[pc];
                }
                musical_frames += 1;
            }
            scores.push(emission);
        }
        let labels = smooth_path(&scores);
        let mut segments: Vec<Segment> = Vec::new();
        let mut counts: Vec<usize> = Vec::new();
        for (i, &label) in labels.iter().enumerate() {
            let start = if i == 0 {
                0.0
            } else {
                (i as f64 - 0.5) * HOP as f64 / SAMPLE_RATE as f64
            };
            let end = if i + 1 == labels.len() {
                duration
            } else {
                ((i as f64 + 0.5) * HOP as f64 / SAMPLE_RATE as f64).min(duration)
            };
            if end <= start {
                continue;
            }
            let chord = chord_name(label);
            let confidence = if label == UNKNOWN {
                0.0
            } else {
                let runner_up = scores[i][..24]
                    .iter()
                    .enumerate()
                    .filter(|(j, _)| *j != label)
                    .map(|(_, &v)| v)
                    .fold(0.0, f32::max);
                ((scores[i][label] - 0.45) * 0.85 + (scores[i][label] - runner_up).max(0.0) * 2.0)
                    .clamp(0.0, 1.0)
            };
            if let Some(previous) = segments.last_mut().filter(|x| x.chord == chord) {
                previous.end = end;
                previous.confidence += confidence;
                *counts.last_mut().unwrap() += 1;
            } else {
                segments.push(Segment {
                    start,
                    end,
                    chord,
                    confidence,
                });
                counts.push(1);
            }
        }
        for (segment, count) in segments.iter_mut().zip(counts) {
            segment.confidence /= count as f32;
        }
        let key = if musical_frames * 3 >= self.frames.len() && musical_frames >= 20 {
            estimate_key(&histogram)
        } else {
            None
        };
        let tempo = if musical_frames * 3 >= self.frames.len() {
            estimate_tempo(&self.envelope)
        } else {
            None
        };
        Ok(Analysis {
            duration,
            segments,
            key,
            tempo,
        })
    }
}

fn normalize(values: &mut [f32; 12]) {
    let norm = values.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 1e-9 {
        for value in values {
            *value /= norm;
        }
    }
}

fn pitch_classes(magnitudes: &[f32]) -> ([f32; 12], [f32; 12], f32) {
    let mut chroma = [0.0f32; 12];
    let mut bass = [0.0f32; 12];
    let first = (55.0 * WINDOW as f32 / SAMPLE_RATE as f32) as usize;
    let last = (2200.0 * WINDOW as f32 / SAMPLE_RATE as f32) as usize;
    let maximum = magnitudes[first..last].iter().copied().fold(0.0, f32::max);
    if maximum < 1e-5 {
        return (chroma, bass, 0.0);
    }
    let mut peaks: Vec<(f32, f32)> = Vec::new();
    let total_energy = magnitudes[first..last].iter().map(|x| x * x).sum::<f32>();
    // Flatness separates broad noise from a harmonic mix with percussion more
    // reliably than requiring most of the mix's energy to occupy narrow peaks.
    let geometric_energy = (magnitudes[first..last]
        .iter()
        .map(|x| (x * x).max(1e-12).ln())
        .sum::<f32>()
        / (last - first) as f32)
        .exp();
    let flatness = geometric_energy / (total_energy / (last - first) as f32).max(1e-12);
    for bin in first..last {
        let amplitude = magnitudes[bin];
        if amplitude < maximum * 0.025
            || amplitude <= magnitudes[bin - 1]
            || amplitude < magnitudes[bin + 1]
        {
            continue;
        }
        let left = magnitudes[bin - 1].max(1e-10).ln();
        let center = amplitude.ln();
        let right = magnitudes[bin + 1].max(1e-10).ln();
        let denominator = left - 2.0 * center + right;
        let shift = if denominator.abs() > 1e-8 {
            (0.5 * (left - right) / denominator).clamp(-0.5, 0.5)
        } else {
            0.0
        };
        let frequency = (bin as f32 + shift) * SAMPLE_RATE as f32 / WINDOW as f32;
        let radius = (bin / 6).max(4);
        let lo = bin.saturating_sub(radius).max(1);
        let hi = (bin + radius).min(magnitudes.len() - 1);
        let local = magnitudes[lo..=hi].iter().sum::<f32>() / (hi - lo + 1) as f32;
        // Discount broad-band energy, compress dynamics and whiten timbre gently.
        if amplitude < local * 2.0 {
            continue;
        }
        let weight = amplitude.powf(0.7) / local.max(maximum * 0.01).powf(0.3);
        peaks.push((frequency, weight));
    }
    for (index, &(frequency, weight)) in peaks.iter().enumerate() {
        let midi = 69.0 + 12.0 * (frequency / 440.0).log2();
        let nearest = midi.round();
        let distance = (midi - nearest).abs();
        if distance > 0.45 {
            continue;
        }
        let pc = (nearest as i32).rem_euclid(12) as usize;
        // A fifth harmonic falls near a major third and can overpower a
        // separately played minor third. Discount it more than octave/fifth
        // harmonics, which also reinforce real chord-root/fifth evidence.
        let harmonic_weight = peaks[..index]
            .iter()
            .fold(1.0f32, |discount, &(lower, strength)| {
                let ratio = frequency / lower;
                let integer = ratio.round();
                if (2.0..=6.0).contains(&integer)
                    && (ratio / integer).log2().abs() < 0.015
                    && strength > weight * 0.4
                {
                    discount.min(if integer == 5.0 { 0.05 } else { 0.22 })
                } else {
                    discount
                }
            });
        let value = weight * (1.0 - distance * 1.3) * harmonic_weight;
        chroma[pc] += value;
        if frequency < 350.0 {
            bass[pc] += value;
        }
    }
    normalize(&mut chroma);
    normalize(&mut bass);
    (chroma, bass, (1.0 - flatness).clamp(0.0, 1.0))
}

fn chord_name(index: usize) -> String {
    if index == UNKNOWN {
        "N".into()
    } else {
        format!(
            "{}{}",
            NAMES[index % 12],
            if index >= 12 { "m" } else { "" }
        )
    }
}

fn chord_scores(chroma: &[f32; 12], bass: &[f32; 12]) -> [f32; 25] {
    let mut out = [0.0; 25];
    for (index, value) in out[..24].iter_mut().enumerate() {
        let root = index % 12;
        let third = (root + if index < 12 { 4 } else { 3 }) % 12;
        let fifth = (root + 7) % 12;
        // Normalized triads; bass is a weak tie-breaker, not an inversion ban.
        *value = (chroma[root] + chroma[third] + chroma[fifth]) / 3.0f32.sqrt() + 0.04 * bass[root];
    }
    out
}

fn smooth_path(scores: &[[f32; 25]]) -> Vec<usize> {
    if scores.is_empty() {
        return Vec::new();
    }
    let mut previous = scores[0];
    let mut back = vec![[0u8; 25]; scores.len()];
    for i in 1..scores.len() {
        let mut next = [0.0; 25];
        for state in 0..25 {
            let (parent, best) = previous
                .iter()
                .enumerate()
                .map(|(parent, &value)| {
                    let penalty = if parent == state {
                        0.0
                    } else if parent == UNKNOWN || state == UNKNOWN {
                        0.40
                    } else {
                        0.85
                    };
                    (parent, value - penalty)
                })
                .max_by(|a, b| a.1.total_cmp(&b.1))
                .unwrap();
            next[state] = best + scores[i][state];
            back[i][state] = parent as u8;
        }
        // Keep long-file accumulation numerically stable.
        let highest = next.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        for value in &mut next {
            *value -= highest;
        }
        previous = next;
    }
    let mut labels = vec![0; scores.len()];
    labels[scores.len() - 1] = previous
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .unwrap()
        .0;
    for i in (1..scores.len()).rev() {
        labels[i - 1] = back[i][labels[i]] as usize;
    }
    labels
}

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
                        assert!(
                            correct > 2.7,
                            "{expected}, notes {notes:?}, bass {bass_gain}: {segments:?}"
                        );
                    }
                }
            }
        }
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
