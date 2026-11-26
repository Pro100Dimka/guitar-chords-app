//! Exercise the exact mobile chord core on 16 kHz mono signed PCM16LE.
//! ffmpeg -i song.mp3 -ac 1 -ar 16000 -f s16le song.pcm
//! cargo run --release --bin chord_probe -- song.pcm
#[path = "../chord_notes.rs"]
mod chord_notes;
#[path = "../chords.rs"]
mod chords;
use std::io::{Read, Write};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("16 kHz mono PCM16LE file required")?;
    let mut file = std::fs::File::open(path)?;
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
    let mut json = analyzer.finish()?.json();
    json.pop();
    json.push_str(&format!(
        ",\"elapsedMs\":{:.3}}}\n",
        started.elapsed().as_secs_f64() * 1000.0
    ));
    std::io::stdout().write_all(json.as_bytes())?;
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
