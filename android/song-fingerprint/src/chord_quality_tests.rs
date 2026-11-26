//! Independent acoustic controls for the extended vocabulary. These synthesize
//! known notes; they never supply expected labels to the production analyzer.
use crate::chords::{ChordAnalyzer, Segment, SAMPLE_RATE};
use std::f64::consts::PI;

const ROOTS: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

// Explicit absolute voicing offsets, independent of the production vocabulary.
// The ninth is voiced above the octave; thirds are independently played notes.
const VOICINGS: [(&str, &[u8]); 14] = [
    ("", &[0, 16, 19]),
    ("m", &[0, 15, 19]),
    ("5", &[0, 19]),
    ("sus2", &[0, 14, 19]),
    ("sus4", &[0, 17, 19]),
    ("6", &[0, 16, 19, 21]),
    ("m6", &[0, 15, 19, 21]),
    ("7", &[0, 16, 19, 22]),
    ("maj7", &[0, 16, 19, 23]),
    ("m7", &[0, 15, 19, 22]),
    ("dim", &[0, 15, 18]),
    ("aug", &[0, 16, 20]),
    ("add9", &[0, 16, 19, 26]),
    ("madd9", &[0, 15, 19, 26]),
];

struct Expected {
    start: f64,
    end: f64,
    label: String,
}

fn add_note(output: &mut [f64], midi: u8, onset: usize, end: usize, gain: f64) {
    let frequency = 440.0 * 2.0f64.powf((midi as f64 - 69.0) / 12.0);
    let length = end - onset;
    for (offset, sample) in output[onset..end].iter_mut().enumerate() {
        let time = offset as f64 / SAMPLE_RATE as f64;
        let attack = (time / 0.012).min(1.0);
        let release = ((length - offset) as f64 / (SAMPLE_RATE as f64 * 0.012)).min(1.0);
        let envelope = attack * release * (0.25 + 0.75 * (-time / 1.2).exp());
        let mut tone = 0.0;
        for harmonic in 1..=10 {
            if frequency * harmonic as f64 >= SAMPLE_RATE as f64 * 0.48 {
                break;
            }
            tone += 0.72f64.powi(harmonic - 1)
                * (2.0 * PI * frequency * harmonic as f64 * time + 0.13 * midi as f64).sin();
        }
        *sample += gain * envelope * tone;
    }
}

fn analyze(signal: &[f64]) -> Vec<Segment> {
    let peak = signal.iter().map(|sample| sample.abs()).fold(0.0, f64::max);
    let mut analyzer = ChordAnalyzer::new();
    // A deliberately irregular input size also exercises streaming boundaries.
    for samples in signal.chunks(4093) {
        let pcm: Vec<i16> = samples
            .iter()
            .map(|sample| (sample / peak.max(1.0) * 26000.0).round() as i16)
            .collect();
        analyzer.push(&pcm).unwrap();
    }
    analyzer.finish().unwrap().segments
}

fn assert_interval(segments: &[Segment], expected: &Expected, margin: f64, fraction: f64) {
    let start = expected.start + margin;
    let end = expected.end - margin;
    let matched: f64 = segments
        .iter()
        .filter(|segment| segment.chord == expected.label)
        .map(|segment| (segment.end.min(end) - segment.start.max(start)).max(0.0))
        .sum();
    let actual: Vec<_> = segments
        .iter()
        .filter(|segment| segment.end > start && segment.start < end)
        .map(|segment| (segment.start, segment.end, segment.chord.as_str()))
        .collect();
    assert!(
        matched >= (end - start) * fraction,
        "{} at {:.3}..{:.3}: matched {:.3}/{:.3}s; actual {:?}",
        expected.label,
        start,
        end,
        matched,
        end - start,
        actual
    );
}

#[test]
fn fourteen_qualities_are_distinguished_in_every_key() {
    let samples_per_chord = SAMPLE_RATE * 5 / 2;
    let cases = VOICINGS.len() * ROOTS.len();
    let mut signal = vec![0.0; samples_per_chord * cases];
    let mut reference = Vec::with_capacity(cases);
    for (quality, &(suffix, offsets)) in VOICINGS.iter().enumerate() {
        for (root, name) in ROOTS.iter().enumerate() {
            let ordinal = quality * ROOTS.len() + root;
            let start = ordinal * samples_per_chord;
            let end = start + samples_per_chord;
            for (voice, offset) in offsets.iter().enumerate() {
                add_note(
                    &mut signal,
                    36 + root as u8 + offset,
                    start,
                    end,
                    if voice == 0 { 1.25 } else { 1.0 },
                );
            }
            reference.push(Expected {
                start: start as f64 / SAMPLE_RATE as f64,
                end: end as f64 / SAMPLE_RATE as f64,
                label: format!("{name}{suffix}"),
            });
        }
    }
    let segments = analyze(&signal);
    for expected in &reference {
        // This is an interior synthetic control, not a full-timeline accuracy
        // metric. It permits boundary uncertainty but not a wrong whole chord.
        assert_interval(&segments, expected, 0.25, 0.90);
    }
}

#[test]
fn rapid_suspensions_resolve_in_every_key_without_new_bass_attacks() {
    let half_second = SAMPLE_RATE / 2;
    let samples_per_root = half_second * 7;
    let mut signal = vec![0.0; samples_per_root * ROOTS.len()];
    let mut reference = Vec::new();
    for (root, name) in ROOTS.iter().enumerate() {
        let start = root * samples_per_root;
        let end = start + samples_per_root;
        let midi = 36 + root as u8;
        // Root and fifth ring continuously through all four quality changes.
        // A rule requiring another bass attack would erase these suspensions.
        add_note(&mut signal, midi, start, end, 1.25);
        add_note(&mut signal, midi + 19, start, end, 1.0);
        let lengths = [
            half_second * 3,
            half_second,
            half_second,
            half_second,
            half_second,
        ];
        let mut cursor = start;
        for (part, length) in lengths.iter().enumerate() {
            let suspended = part % 2 == 1;
            add_note(
                &mut signal,
                midi + if suspended { 17 } else { 16 },
                cursor,
                cursor + length,
                1.0,
            );
            reference.push(Expected {
                start: cursor as f64 / SAMPLE_RATE as f64,
                end: (cursor + length) as f64 / SAMPLE_RATE as f64,
                label: format!("{name}{}", if suspended { "sus4" } else { "" }),
            });
            cursor += length;
        }
    }
    let segments = analyze(&signal);
    for expected in &reference {
        // A 75ms boundary margin is smaller than the 500ms event. Most of each
        // short suspension must survive; a single sustained major label fails.
        assert_interval(&segments, expected, 0.075, 0.70);
    }
}
