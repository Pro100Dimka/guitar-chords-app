//! Exercise the exact mobile chord core on 16 kHz mono signed PCM16LE.
//! ffmpeg -i song.mp3 -ac 1 -ar 16000 -f s16le song.pcm
//! cargo run --release --bin chord_probe -- song.pcm
//! Optional --note-trace PATH writes retained model frames centered in [0, 4s).
#[path = "../chord_notes.rs"]
mod chord_notes;
#[path = "../note_events.rs"]
mod note_events;
#[path = "../chords.rs"]
mod chords;
use std::io::{BufWriter, Read, Write};

fn write_activations(output: &mut impl Write, values: &[f32]) -> std::io::Result<()> {
    output.write_all(b"[")?;
    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            output.write_all(b",")?;
        }
        // Ten significant digits retain every bit of the f32 model activation.
        write!(output, "{value:.9e}")?;
    }
    output.write_all(b"]")
}

fn write_note_trace(
    analyzer: &chords::ChordAnalyzer,
    duration: f64,
    output: &mut impl Write,
) -> std::io::Result<()> {
    let end = duration.min(4.0);
    write!(
        output,
        "{{\"schemaVersion\":1,\"duration\":{duration:.15},\"firstMidi\":{},\"noteCount\":{},\"frameCenterRange\":{{\"start\":0,\"end\":{end:.15}}},\"frames\":[",
        chord_notes::FIRST_MIDI_NOTE,
        chord_notes::NOTE_COUNT,
    )?;
    let mut count = 0;
    analyzer.visit_note_frames(|frame| -> std::io::Result<bool> {
        if frame.time >= end {
            return Ok(false);
        }
        if count > 0 {
            output.write_all(b",")?;
        }
        // Select by center; preserve the original, unclipped coverage boundaries.
        write!(
            output,
            "{{\"time\":{:.15},\"start\":{:.15},\"end\":{:.15},\"notes\":",
            frame.time, frame.start, frame.end,
        )?;
        write_activations(output, &frame.notes)?;
        output.write_all(b",\"onsets\":")?;
        write_activations(output, &frame.onsets)?;
        output.write_all(b"}")?;
        count += 1;
        Ok(true)
    })?;
    output.write_all(b"]}\n")?;
    output.flush()
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args_os().skip(1);
    let path = args.next().ok_or("16 kHz mono PCM16LE file required")?;
    let trace_path = match args.next() {
        None => None,
        Some(flag) if flag == "--note-trace" => {
            Some(args.next().ok_or("--note-trace requires an output path")?)
        }
        Some(_) => return Err("Usage: chord_probe PCM [--note-trace PATH]".into()),
    };
    if args.next().is_some() {
        return Err("Usage: chord_probe PCM [--note-trace PATH]".into());
    }
    let mut file = std::fs::File::open(path)?;
    // Refuse existing destinations, including the PCM input, before inference.
    let mut trace = trace_path
        .map(|path| {
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .map(BufWriter::new)
        })
        .transpose()?;
    let mut analyzer = chords::ChordAnalyzer::new();
    let started = std::time::Instant::now();
    let mut bytes = [0u8; 16_384];
    let mut trailing: Option<u8> = None;
    loop {
        let length = file.read(&mut bytes)?;
        if length == 0 {
            break;
        }
        let mut pcm = Vec::with_capacity(length / 2 + 1);
        let mut offset = 0;
        if let Some(first) = trailing.take() {
            pcm.push(i16::from_le_bytes([first, bytes[0]]));
            offset = 1;
        }
        let mut pairs = bytes[offset..length].chunks_exact(2);
        pcm.extend(pairs.by_ref().map(|b| i16::from_le_bytes([b[0], b[1]])));
        trailing = pairs.remainder().first().copied();
        analyzer.push(&pcm)?;
    }
    if trailing.is_some() {
        return Err("Incomplete PCM16 sample".into());
    }
    let analysis = analyzer.finish()?;
    let mut json = analysis.json();
    json.pop();
    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    json.push_str(&format!(",\"elapsedMs\":{elapsed_ms:.3}}}\n"));
    // Optional serialization is outside the native processing-time measurement.
    if let Some(output) = trace.as_mut() {
        write_note_trace(&analyzer, analysis.duration, output)?;
    }
    std::io::stdout().write_all(json.as_bytes())?;
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
