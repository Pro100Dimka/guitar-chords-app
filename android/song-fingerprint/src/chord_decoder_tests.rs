//! Generic note-activation regressions for the hierarchy, independent of songs
//! and model inference. The explicit frame labels isolate preservation of the
//! generic decoder's quality evidence during root-span merging.
use super::*;

struct Activations {
    frames: Vec<NoteFrame>,
    duration: f64,
}

impl Activations {
    fn new(duration: f64) -> Self {
        let count = (duration / NOTE_STEP).ceil() as usize;
        let frames = (0..count)
            .map(|index| {
                let time = index as f64 * NOTE_STEP;
                NoteFrame {
                    time,
                    start: (time - NOTE_STEP * 0.5).max(0.0),
                    end: (time + NOTE_STEP * 0.5).min(duration),
                    notes: [0.0; NOTE_COUNT],
                    onsets: [0.0; NOTE_COUNT],
                }
            })
            .collect();
        Self { frames, duration }
    }

    fn hold(&mut self, midi: usize, start: f64, end: f64, strength: f32) {
        for frame in &mut self.frames {
            if frame.time >= start && frame.time < end {
                frame.notes[midi - FIRST_MIDI_NOTE] = strength;
            }
        }
    }

    fn attack(&mut self, midi: usize, time: f64) {
        let index = ((time / NOTE_STEP).round() as usize).min(self.frames.len() - 1);
        self.frames[index].onsets[midi - FIRST_MIDI_NOTE] = 0.9;
    }

    fn common_root_fifth(&mut self, strength: f32) {
        for midi in [48, 55] {
            self.hold(midi, 0.0, self.duration, strength);
            self.attack(midi, 0.0);
        }
    }

    fn infer(self, qualities: &[(f64, &str)]) -> Vec<Segment> {
        let mut storage = NoteStorage::default();
        storage.extend(self.frames);
        let count = (self.duration * SAMPLE_RATE as f64 / HOP as f64).ceil() as usize;
        let path: Vec<usize> = (0..count)
            .map(|index| {
                let time = index as f64 * HOP as f64 / SAMPLE_RATE as f64;
                let label = qualities
                    .iter()
                    .rev()
                    .find(|(start, _)| *start <= time)
                    .unwrap()
                    .1;
                (0..UNKNOWN)
                    .find(|&candidate| chord_name(candidate) == label)
                    .unwrap()
            })
            .collect();
        let scores: Vec<[f32; STATES]> = path
            .iter()
            .map(|&label| {
                let mut score = [0.0; STATES];
                score[label] = 1.0;
                score
            })
            .collect();
        let spans = root_spans(&path, &scores, self.duration);
        infer_quality(&storage, &spans)
    }
}

fn assert_segments(actual: &[Segment], expected: &[(f64, f64, &str)], context: &str) {
    assert_eq!(actual.len(), expected.len(), "{context}: {actual:?}");
    for (segment, &(start, end, label)) in actual.iter().zip(expected) {
        assert_eq!(segment.chord, label, "{context}: {actual:?}");
        assert!(
            (segment.start - start).abs() <= 0.18 && (segment.end - end).abs() <= 0.18,
            "{context}: expected {label} at {start}..{end}, got {actual:?}"
        );
        assert!(segment.start < segment.end, "{context}: {actual:?}");
        assert!(
            segment.confidence.is_finite() && (0.0..=1.0).contains(&segment.confidence),
            "{context}: {actual:?}"
        );
    }
    assert_eq!(actual[0].start, expected[0].0);
    assert_eq!(actual.last().unwrap().end, expected.last().unwrap().1);
    for pair in actual.windows(2) {
        assert_eq!(pair[0].end, pair[1].start, "{context}: {actual:?}");
    }
}

#[test]
fn quality_boundary_ignores_distant_root_reattacks_and_needs_no_new_bass() {
    for reattack in [false, true] {
        let mut input = Activations::new(16.0);
        input.common_root_fifth(0.85);
        input.hold(64, 0.0, 6.0, 0.85);
        input.attack(64, 0.0);
        input.hold(63, 6.0, 16.0, 0.85);
        input.attack(63, 6.0);
        if reattack {
            for time in [1.0, 2.0, 3.0, 6.0, 9.0, 12.0, 15.0] {
                input.attack(48, time);
            }
        }
        assert_segments(
            &input.infer(&[(0.0, "C"), (6.0, "Cm")]),
            &[(0.0, 6.0, "C"), (6.0, 16.0, "Cm")],
            &format!("new bass attack: {reattack}"),
        );
    }
}

#[test]
fn stable_same_root_extensions_and_altered_fifths_keep_their_boundaries() {
    let cases: &[(&str, &[usize], &str, &[usize])] = &[
        ("C", &[48, 55, 64], "C7", &[48, 55, 64, 70]),
        ("C", &[48, 55, 64], "C6", &[48, 55, 64, 69]),
        ("C7", &[48, 55, 64, 70], "Cmaj7", &[48, 55, 64, 71]),
        ("C7", &[48, 55, 64, 70], "C", &[48, 55, 64]),
        ("C", &[48, 55, 64], "Cadd9", &[48, 55, 64, 74]),
        ("Cadd9", &[48, 55, 64, 74], "C", &[48, 55, 64]),
        ("Cm", &[48, 55, 63], "Cmadd9", &[48, 55, 63, 74]),
        ("Cmadd9", &[48, 55, 63, 74], "Cm", &[48, 55, 63]),
        ("Cdim", &[48, 63, 66], "Caug", &[48, 64, 68]),
    ];
    for &(old_label, old_notes, new_label, new_notes) in cases {
        let mut input = Activations::new(8.0);
        for &midi in old_notes {
            input.hold(
                midi,
                0.0,
                if new_notes.contains(&midi) { 8.0 } else { 4.0 },
                0.85,
            );
            input.attack(midi, 0.0);
        }
        for &midi in new_notes {
            if !old_notes.contains(&midi) {
                input.hold(midi, 4.0, 8.0, 0.85);
                input.attack(midi, 4.0);
            }
        }
        assert_segments(
            &input.infer(&[(0.0, old_label), (4.0, new_label)]),
            &[(0.0, 4.0, old_label), (4.0, 8.0, new_label)],
            &format!("{old_label} -> {new_label}"),
        );
    }
}

#[test]
fn short_passing_fourth_over_an_established_decaying_third_keeps_major() {
    let mut input = Activations::new(4.0);
    input.common_root_fifth(0.5);
    input.hold(64, 0.0, 1.0, 0.8);
    input.hold(64, 1.0, 4.0, 0.22);
    input.attack(64, 0.0);
    input.hold(65, 1.5, 1.7, 0.8);
    input.attack(65, 1.5);
    assert_segments(
        &input.infer(&[(0.0, "C")]),
        &[(0.0, 4.0, "C")],
        "short F over sustained C/E/G",
    );
}

#[test]
fn genuine_sustained_suspension_and_resolution_remain_detectable() {
    for resolve in [false, true] {
        let duration = if resolve { 6.0 } else { 4.0 };
        let mut input = Activations::new(duration);
        input.common_root_fifth(0.5);
        input.hold(64, 0.0, 2.0, 0.8);
        input.attack(64, 0.0);
        input.hold(65, 2.0, 4.0, 0.8);
        input.attack(65, 2.0);
        let mut qualities = vec![(0.0, "C"), (2.0, "Csus4")];
        let mut expected = vec![(0.0, 2.0, "C"), (2.0, 4.0, "Csus4")];
        if resolve {
            input.hold(64, 4.0, 6.0, 0.8);
            input.attack(64, 4.0);
            qualities.push((4.0, "C"));
            expected.push((4.0, 6.0, "C"));
        }
        assert_segments(&input.infer(&qualities), &expected, "sustained suspension");
    }
}

#[test]
fn delayed_arpeggio_third_is_completion_of_one_chord() {
    let mut input = Activations::new(4.0);
    input.common_root_fifth(0.85);
    input.hold(64, 1.5, 4.0, 0.85);
    input.attack(64, 1.5);
    assert_segments(
        &input.infer(&[(0.0, "C5"), (1.5, "C")]),
        &[(0.0, 4.0, "C")],
        "delayed third",
    );
}

#[test]
fn delayed_new_third_can_complete_recent_arpeggiated_root_and_fifth() {
    let mut input = Activations::new(8.0);
    for midi in [48, 55] {
        input.hold(midi, 0.0, 8.0, 0.18);
        input.hold(midi, 0.0, 3.0, 0.85);
        input.attack(midi, 0.0);
    }
    input.hold(64, 0.0, 3.0, 0.85);
    input.attack(64, 0.0);
    input.hold(48, 3.0, 3.3, 0.85);
    input.attack(48, 3.0);
    input.hold(55, 3.5, 3.8, 0.85);
    input.attack(55, 3.5);
    input.hold(63, 4.5, 8.0, 0.5);
    input.attack(63, 4.5);
    assert_segments(
        &input.infer(&[(0.0, "C"), (3.0, "C5"), (4.5, "Cm")]),
        &[(0.0, 3.0, "C"), (3.0, 8.0, "Cm")],
        "new minor third follows separately played root/fifth after their decay",
    );
}

#[test]
fn early_nested_seventh_arpeggio_is_completion_of_one_chord() {
    let mut input = Activations::new(4.0);
    for (midi, time) in [(48, 0.0), (55, 0.1), (64, 0.2), (70, 0.45)] {
        input.hold(midi, time, 4.0, 0.85);
        input.attack(midi, time);
    }
    assert_segments(
        &input.infer(&[(0.0, "C5"), (0.2, "C"), (0.45, "C7")]),
        &[(0.0, 4.0, "C7")],
        "early seventh arpeggio",
    );
}
