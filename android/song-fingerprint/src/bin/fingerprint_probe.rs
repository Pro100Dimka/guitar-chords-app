// Reproducible host probe for the exact native fingerprint implementation.
// Usage: ffmpeg -i input.ogg -t 12 -ac 1 -ar 16000 -f s16le sample.pcm
//        cargo run --bin fingerprint_probe -- sample.pcm
#[path = "../algorithm.rs"]
mod algorithm;
#[path = "../signature_format.rs"]
mod signature_format;
use std::io::{self, Write};
fn main() {
    let path = std::env::args().nth(1).expect("PCM path required");
    let bytes = std::fs::read(path).expect("PCM file unreadable");
    assert!(bytes.len() % 2 == 0 && (64_000..=416_000).contains(&bytes.len()),
        "2 to 13 seconds of 16 kHz mono PCM16 needed; only 12 seconds are fingerprinted");
    let samples: Vec<i16> = bytes.chunks_exact(2)
        .take(192_000).map(|v| i16::from_le_bytes([v[0], v[1]])).collect();
    let signature = algorithm::fingerprint_samples(&samples).to_data_uri();
    io::stdout().write_all(signature.as_bytes()).unwrap();
}
