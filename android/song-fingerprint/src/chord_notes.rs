//! Streaming Basic Pitch front end; no chord vocabulary or song-specific rules.
//!
//! Apache-2.0 Spotify weights are embedded as build-time-converted NNEF. Native
//! callers still supply 16 kHz PCM16. A rational, bandlimited resampler provides
//! 22.05 kHz model windows without retaining the recording. See the adjacent
//! model LICENSE, NOTICE and provenance.json for attribution and exact weights.
use std::collections::VecDeque;
use std::f64::consts::PI;
use std::sync::{Arc, OnceLock};
use tract_nnef::prelude::*;

pub const INPUT_SAMPLE_RATE: usize = 16_000;
pub const MODEL_SAMPLE_RATE: usize = 22_050;
pub const MAX_INPUT_SAMPLES: usize = INPUT_SAMPLE_RATE * 900;
pub const MAX_INPUT_CHUNK: usize = 16_384;
pub const FIRST_MIDI_NOTE: usize = 21;
pub const NOTE_COUNT: usize = 88;
const WINDOW_SAMPLES: usize = 43_844;
const FRAME_HOP: usize = 256;
const MODEL_FRAMES: usize = 172;
const TRIM_FRAMES: usize = 15;
const PREFIX_SAMPLES: usize = TRIM_FRAMES * FRAME_HOP;
const WINDOW_HOP: usize = WINDOW_SAMPLES - 2 * PREFIX_SAMPLES;
const RETAINED_FRAMES: usize = MODEL_FRAMES - 2 * TRIM_FRAMES;
const MAX_FINISH_FRAMES: usize = 2 * RETAINED_FRAMES + 1;
const MODEL_BYTES: &[u8] = include_bytes!("../models/basic-pitch/nmp.nnef.tar");
// NNEF-safe output labels, preserved by the pinned build-time converter.
const OUTPUT_NAMES: [&str; 2] = ["StatefulPartitionedCall_1", "StatefulPartitionedCall_2"];

// 22050 / 16000 = 441 / 320. Integer phase/position arithmetic prevents drift.
const UPSAMPLE: usize = 441;
const DOWNSAMPLE: usize = 320;
const RESAMPLE_RADIUS: usize = 48;
const RESAMPLE_LEFT: usize = RESAMPLE_RADIUS - 1;
const RESAMPLE_TAPS: usize = RESAMPLE_RADIUS * 2;
const RESAMPLE_CUTOFF: f64 = 0.94;
static RESAMPLE_KERNEL: OnceLock<Vec<[f32; RESAMPLE_TAPS]>> = OnceLock::new();
static MODEL: OnceLock<Result<Arc<TypedSimplePlan>, String>> = OnceLock::new();

/// Raw model activations. Index zero represents MIDI 21 (A0); index 87 is C8.
/// `time` is the frame center, in original recording seconds. Consecutive
/// [start, end] intervals cover the real recording exactly, including its tail.
#[derive(Debug, Clone)]
pub struct NoteFrame {
    pub time: f64,
    pub start: f64,
    pub end: f64,
    pub notes: [f32; NOTE_COUNT],
    pub onsets: [f32; NOTE_COUNT],
}

/// One worker owns one analyzer. The immutable optimized graph is shared;
/// every model.run creates independent evaluation state, including scratch data.
/// Input and returned batches are bounded independently of recording duration.
pub struct NoteAnalyzer {
    resampler: BandlimitedResampler,
    window: VecDeque<f32>,
    window_number: usize,
    last_frame: Option<NoteFrame>,
    finished: bool,
}

impl Default for NoteAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

impl NoteAnalyzer {
    pub fn new() -> Self {
        Self {
            resampler: BandlimitedResampler::new(),
            window: VecDeque::from(vec![0.0; PREFIX_SAMPLES]),
            window_number: 0,
            last_frame: None,
            finished: false,
        }
    }

    /// Consume at most 16,384 signed PCM16 samples, matching the native ABI.
    /// Larger callers must split their input; at most one model window completes
    /// per call. Completed frames are returned, never accumulated in this object.
    pub fn push16k(&mut self, pcm: &[i16]) -> Result<Vec<NoteFrame>, &'static str> {
        self.check_input(pcm.len())?;
        self.window.extend(self.resampler.push(pcm));
        let result = self.extract_complete_windows();
        if result.is_err() {
            self.finished = true;
        }
        result
    }

    fn check_input(&self, count: usize) -> Result<(), &'static str> {
        if self.finished {
            return Err("AnalysisFinished");
        }
        if count > MAX_INPUT_SAMPLES.saturating_sub(self.resampler.received) {
            return Err("AudioTooLong");
        }
        if count > MAX_INPUT_CHUNK {
            return Err("AudioChunkTooLarge");
        }
        Ok(())
    }

    /// Flush filter context and the final padded model window. Padding affects
    /// inference only: timestamps and coverage stop at the original PCM duration.
    /// A too-short finish leaves the stream open, matching the existing bridge.
    pub fn finish(&mut self) -> Result<Vec<NoteFrame>, &'static str> {
        if self.finished {
            return Err("AnalysisFinished");
        }
        if self.resampler.received < INPUT_SAMPLE_RATE {
            return Err("AudioTooShort");
        }
        self.finished = true;
        self.window.extend(self.resampler.finish());
        let mut output = self.extract_complete_windows()?;
        // A retained window starts at window_number * WINDOW_HOP. Do not run
        // trailing windows whose retained output would lie entirely in padding.
        while self.frame_is_in_audio(self.window_number * WINDOW_HOP) {
            self.window.resize(WINDOW_SAMPLES, 0.0);
            self.extract_window(&mut output)?;
        }
        if let Some(mut last) = self.last_frame.take() {
            last.end = self.duration();
            if last.end > last.start {
                output.push(last);
            }
        }
        self.window.clear();
        debug_assert!(output.len() <= MAX_FINISH_FRAMES);
        Ok(output)
    }

    pub fn duration(&self) -> f64 {
        self.resampler.received as f64 / INPUT_SAMPLE_RATE as f64
    }

    fn frame_is_in_audio(&self, model_sample: usize) -> bool {
        // Cross products exceed 32 bits during a long recording.
        model_sample as u64 * (INPUT_SAMPLE_RATE as u64)
            < self.resampler.received as u64 * (MODEL_SAMPLE_RATE as u64)
    }

    fn extract_complete_windows(&mut self) -> Result<Vec<NoteFrame>, &'static str> {
        let mut output = Vec::new();
        while self.window.len() >= WINDOW_SAMPLES {
            self.extract_window(&mut output)?;
        }
        Ok(output)
    }

    fn extract_window(&mut self, output: &mut Vec<NoteFrame>) -> Result<(), &'static str> {
        let samples: Vec<f32> = self.window.iter().take(WINDOW_SAMPLES).copied().collect();
        let (notes, onsets) = predict_window(&samples)?;
        for local_frame in TRIM_FRAMES..MODEL_FRAMES - TRIM_FRAMES {
            // CQT centers advance 256 samples within each actual input window.
            // Initial zero padding equals 15 hops, so both cancel here. The
            // 36164-sample window hop is NOT 142*256: seams have a 68-sample
            // center spacing, represented explicitly rather than accumulating
            // a global time correction over a long recording.
            let position =
                self.window_number * WINDOW_HOP + (local_frame - TRIM_FRAMES) * FRAME_HOP;
            if !self.frame_is_in_audio(position) {
                break;
            }
            let mut next = NoteFrame {
                time: position as f64 / MODEL_SAMPLE_RATE as f64,
                start: 0.0,
                end: 0.0,
                notes: notes[local_frame],
                onsets: onsets[local_frame],
            };
            if let Some(mut previous) = self.last_frame.take() {
                let boundary = (previous.time + next.time) * 0.5;
                previous.end = boundary;
                next.start = boundary;
                output.push(previous);
            }
            self.last_frame = Some(next);
        }
        self.window.drain(..WINDOW_HOP);
        self.window_number += 1;
        Ok(())
    }
}

type Activations = Vec<[f32; NOTE_COUNT]>;

fn predict_window(samples: &[f32]) -> Result<(Activations, Activations), &'static str> {
    if samples.len() != WINDOW_SAMPLES {
        return Err("AudioAnalysisFailed");
    }
    let model = MODEL
        .get_or_init(load_model)
        .as_ref()
        .map_err(|_| "AudioAnalysisFailed")?;
    let input =
        Tensor::from_shape(&[1, WINDOW_SAMPLES, 1], samples).map_err(|_| "AudioAnalysisFailed")?;
    let predictions = model
        .run(tvec!(input.into()))
        .map_err(|_| "AudioAnalysisFailed")?;
    if predictions.len() != OUTPUT_NAMES.len() {
        return Err("AudioAnalysisFailed");
    }
    // Keep the two ~60KB heads off small mobile worker stacks.
    let mut result = [
        vec![[0.0; NOTE_COUNT]; MODEL_FRAMES],
        vec![[0.0; NOTE_COUNT]; MODEL_FRAMES],
    ];
    for (head, prediction) in predictions.iter().enumerate() {
        let view = prediction
            .to_plain_array_view::<f32>()
            .map_err(|_| "AudioAnalysisFailed")?;
        if view.shape() != [1, MODEL_FRAMES, NOTE_COUNT] {
            return Err("AudioAnalysisFailed");
        }
        for frame in 0..MODEL_FRAMES {
            for pitch in 0..NOTE_COUNT {
                let value = view[[0, frame, pitch]];
                if !value.is_finite() || !(0.0..=1.0).contains(&value) {
                    return Err("AudioAnalysisFailed");
                }
                result[head][frame][pitch] = value;
            }
        }
    }
    let [notes, onsets] = result;
    Ok((notes, onsets))
}

fn load_model() -> Result<Arc<TypedSimplePlan>, String> {
    let mut graph = tract_nnef::nnef()
        .model_for_read(&mut std::io::Cursor::new(MODEL_BYTES))
        .map_err(|error| error.to_string())?;
    if graph
        .input_outlets()
        .map_err(|error| error.to_string())?
        .len()
        != 1
    {
        return Err("Expected exactly one model input".to_owned());
    }
    let input = graph.input_fact(0).map_err(|error| error.to_string())?;
    if input.datum_type != f32::datum_type()
        || input.shape.as_concrete() != Some(&[1, WINDOW_SAMPLES, 1])
    {
        return Err("Expected fixed float32 model input [1,43844,1]".to_owned());
    }
    let outputs = graph
        .output_outlets()
        .map_err(|error| error.to_string())?
        .to_vec();
    let selected = OUTPUT_NAMES
        .iter()
        .map(|name| {
            outputs
                .iter()
                .copied()
                .find(|&outlet| graph.outlet_label(outlet) == Some(*name))
                .ok_or_else(|| format!("Missing model output {name}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    graph
        .select_output_outlets(&selected)
        .map_err(|error| error.to_string())?;
    // The converter fixes batch=1 and declutters before serialization. Runtime
    // optimization lowers the remaining graph without including an ONNX parser.
    let model = graph
        .into_optimized()
        .map_err(|error| error.to_string())?
        .into_runnable()
        .map_err(|error| error.to_string())?;
    Ok(model)
}

/// A 96-tap Blackman-windowed sinc, with 441 precomputed fractional phases.
/// The cutoff is 0.94 of the input Nyquist frequency. The symmetric lookahead
/// is compensated in the integer output positions, not added to timestamps.
fn resample_kernel() -> &'static [[f32; RESAMPLE_TAPS]] {
    RESAMPLE_KERNEL.get_or_init(|| {
        (0..UPSAMPLE)
            .map(|phase| {
                let fraction = phase as f64 / UPSAMPLE as f64;
                let mut coefficients = [0.0f64; RESAMPLE_TAPS];
                for (tap, coefficient) in coefficients.iter_mut().enumerate() {
                    let distance = tap as f64 - RESAMPLE_LEFT as f64 - fraction;
                    let argument = PI * RESAMPLE_CUTOFF * distance;
                    let sinc = if argument.abs() < 1e-12 {
                        1.0
                    } else {
                        argument.sin() / argument
                    };
                    let window = 0.42
                        + 0.5 * (PI * distance / RESAMPLE_RADIUS as f64).cos()
                        + 0.08 * (2.0 * PI * distance / RESAMPLE_RADIUS as f64).cos();
                    *coefficient = RESAMPLE_CUTOFF * sinc * window;
                }
                let sum: f64 = coefficients.iter().sum();
                coefficients.map(|coefficient| (coefficient / sum) as f32)
            })
            .collect()
    })
}

struct BandlimitedResampler {
    pending: VecDeque<f32>,
    first_sample: usize,
    received: usize,
    next_output: usize,
}

impl BandlimitedResampler {
    fn new() -> Self {
        Self {
            pending: VecDeque::new(),
            first_sample: 0,
            received: 0,
            next_output: 0,
        }
    }

    fn push(&mut self, pcm: &[i16]) -> Vec<f32> {
        self.pending
            .extend(pcm.iter().map(|&sample| sample as f32 / 32768.0));
        self.received += pcm.len();
        self.extract(false)
    }

    fn finish(&mut self) -> Vec<f32> {
        let output = self.extract(true);
        self.pending.clear();
        self.first_sample = self.received;
        output
    }

    fn extract(&mut self, flush: bool) -> Vec<f32> {
        let target = (self.received as u64 * UPSAMPLE as u64).div_ceil(DOWNSAMPLE as u64) as usize;
        let mut output = Vec::with_capacity(target.saturating_sub(self.next_output));
        let kernels = resample_kernel();
        while self.next_output < target {
            let numerator = self.next_output as u64 * DOWNSAMPLE as u64;
            let center = (numerator / UPSAMPLE as u64) as usize;
            let phase = (numerator % UPSAMPLE as u64) as usize;
            if !flush && center + RESAMPLE_RADIUS >= self.received {
                break;
            }
            let mut value = 0.0;
            for (tap, coefficient) in kernels[phase].iter().enumerate() {
                let index = center as i64 + tap as i64 - RESAMPLE_LEFT as i64;
                if index >= self.first_sample as i64 && index < self.received as i64 {
                    value += self.pending[index as usize - self.first_sample] * coefficient;
                }
            }
            output.push(value);
            self.next_output += 1;
        }
        let next_center = (self.next_output as u64 * DOWNSAMPLE as u64 / UPSAMPLE as u64) as usize;
        let discard_before = next_center.saturating_sub(RESAMPLE_LEFT).min(self.received);
        let discard = discard_before.saturating_sub(self.first_sample);
        self.pending.drain(..discard);
        self.first_sample = discard_before;
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(samples: usize, frequency: f64) -> Vec<i16> {
        (0..samples)
            .map(|index| {
                (12000.0 * (2.0 * PI * frequency * index as f64 / INPUT_SAMPLE_RATE as f64).sin())
                    as i16
            })
            .collect()
    }

    fn resample(pcm: &[i16], chunk_size: usize) -> Vec<f32> {
        let mut resampler = BandlimitedResampler::new();
        let mut output = Vec::new();
        for chunk in pcm.chunks(chunk_size) {
            output.extend(resampler.push(chunk));
            assert!(resampler.pending.len() <= RESAMPLE_TAPS);
        }
        output.extend(resampler.finish());
        output
    }

    fn analyze(pcm: &[i16], chunk_size: usize) -> Vec<NoteFrame> {
        let mut analyzer = NoteAnalyzer::new();
        let mut frames = Vec::new();
        for chunk in pcm.chunks(chunk_size) {
            let batch = analyzer.push16k(chunk).unwrap();
            assert!(batch.len() <= RETAINED_FRAMES);
            assert!(analyzer.window.len() < WINDOW_SAMPLES);
            frames.extend(batch);
        }
        frames.extend(analyzer.finish().unwrap());
        frames
    }

    #[test]
    fn resampler_is_chunk_invariant_and_suppresses_upsampling_images() {
        let pcm = tone(INPUT_SAMPLE_RATE, 6000.0);
        let output = resample(&pcm, 16384);
        assert_eq!(output.len(), MODEL_SAMPLE_RATE);
        assert_eq!(output, resample(&pcm, 137));
        assert_eq!(output, resample(&pcm, 1));
        let amplitude = |frequency: f64| {
            let mut real = 0.0;
            let mut imaginary = 0.0;
            for (index, &value) in output.iter().enumerate().skip(1000).take(20000) {
                let phase = 2.0 * PI * frequency * index as f64 / MODEL_SAMPLE_RATE as f64;
                real += value as f64 * phase.cos();
                imaginary += value as f64 * phase.sin();
            }
            2.0 * real.hypot(imaginary) / 20000.0
        };
        assert!((amplitude(6000.0) - 12000.0 / 32768.0).abs() < 0.001);
        assert!(amplitude(10000.0) < 0.001);
        // Compensated symmetric lookahead must not shift the source clock.
        let mut impulse = vec![0; 1600];
        impulse[320] = 16384;
        let impulse = resample(&impulse, 53);
        let peak = impulse
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| a.abs().total_cmp(&b.abs()))
            .unwrap()
            .0;
        assert_eq!(peak, 441);
    }

    #[test]
    fn streaming_frames_are_chunk_invariant_and_cover_exact_duration() {
        let pcm = tone(INPUT_SAMPLE_RATE * 4 + 37, 220.0);
        let large = analyze(&pcm, MAX_INPUT_CHUNK);
        let small = analyze(&pcm, 719);
        assert_eq!(large.len(), small.len());
        assert_eq!(large.first().unwrap().start, 0.0);
        assert_eq!(
            large.last().unwrap().end,
            pcm.len() as f64 / INPUT_SAMPLE_RATE as f64
        );
        for (a, b) in large.iter().zip(&small) {
            assert_eq!((a.time, a.start, a.end), (b.time, b.start, b.end));
            assert_eq!(a.notes, b.notes);
            assert_eq!(a.onsets, b.onsets);
            assert!(a.start <= a.time && a.time < a.end);
        }
        for frames in large.windows(2) {
            assert!(frames[0].time < frames[1].time);
            assert_eq!(frames[0].end, frames[1].start);
        }
        assert_eq!(
            large[RETAINED_FRAMES].time,
            WINDOW_HOP as f64 / MODEL_SAMPLE_RATE as f64
        );
    }

    #[test]
    fn silence_short_input_and_terminal_state_are_well_defined() {
        let mut analyzer = NoteAnalyzer::new();
        assert!(analyzer.push16k(&[]).unwrap().is_empty());
        analyzer.push16k(&vec![0; INPUT_SAMPLE_RATE - 1]).unwrap();
        assert_eq!(analyzer.finish().unwrap_err(), "AudioTooShort");
        analyzer.push16k(&[0]).unwrap();
        let frames = analyzer.finish().unwrap();
        assert_eq!(frames[0].start, 0.0);
        assert_eq!(frames.last().unwrap().end, 1.0);
        assert!(frames
            .iter()
            .flat_map(|frame| frame.notes.iter().chain(&frame.onsets))
            .all(|value| value.is_finite() && (0.0..=1.0).contains(value)));
        assert_eq!(analyzer.push16k(&[0]).unwrap_err(), "AnalysisFinished");
        assert_eq!(analyzer.finish().unwrap_err(), "AnalysisFinished");
    }

    #[test]
    fn input_limits_are_checked_before_state_changes() {
        let mut analyzer = NoteAnalyzer::new();
        assert_eq!(
            analyzer.push16k(&vec![0; MAX_INPUT_CHUNK + 1]).unwrap_err(),
            "AudioChunkTooLarge"
        );
        assert_eq!(analyzer.resampler.received, 0);
        assert_eq!(
            analyzer.check_input(MAX_INPUT_SAMPLES + 1).unwrap_err(),
            "AudioTooLong"
        );
        assert_eq!(analyzer.resampler.received, 0);
        // Check the exact last valid input/output time without running 900s of
        // inference. The guard depends solely on the received sample counter.
        analyzer.resampler.received = MAX_INPUT_SAMPLES;
        assert!(analyzer.frame_is_in_audio(MODEL_SAMPLE_RATE * 900 - 1));
        assert!(!analyzer.frame_is_in_audio(MODEL_SAMPLE_RATE * 900));
        assert_eq!(analyzer.push16k(&[0]).unwrap_err(), "AudioTooLong");
        assert_eq!(analyzer.duration(), 900.0);
    }

    #[test]
    fn cached_graph_supports_two_independent_workers() {
        let first = std::thread::spawn(|| analyze(&tone(INPUT_SAMPLE_RATE, 220.0), 8000));
        let second = std::thread::spawn(|| analyze(&tone(INPUT_SAMPLE_RATE, 330.0), 8000));
        let first = first.join().unwrap();
        let second = second.join().unwrap();
        assert_ne!(first[20].notes, second[20].notes);
        let repeated = analyze(&tone(INPUT_SAMPLE_RATE, 220.0), 8000);
        assert_eq!(first[20].notes, repeated[20].notes);
        assert_eq!(first[20].onsets, repeated[20].onsets);
    }
}
