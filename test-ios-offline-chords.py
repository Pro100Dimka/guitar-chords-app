"""Exercise production Swift decoding and the shared Rust chord core on macOS."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile


if sys.platform != "darwin":
    raise SystemExit("Requires macOS, Swift and AVFoundation. No iOS checks ran.")

root = Path(__file__).resolve().parent
source = (root / "ios/OfflineChordAnalysis.swift").read_text(encoding="utf-8")
source = (source.replace("import React", "").replace(", RCTBridgeModule", "")
          .replace("@objc(OfflineChordAnalysis)", "").replace("@objc ", "")
          .replace("private ", ""))
fixture = r'''
import AVFoundation
import Foundation
typealias RCTPromiseResolveBlock = (Any?) -> Void
typealias RCTPromiseRejectBlock = (String?, String?, Error?) -> Void

func writeAudio(_ url: URL, aac: Bool, seconds: Double = 16) throws {
  let rate = 44100.0
  let settings: [String: Any] = aac ? [
    AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: rate,
    AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 128000
  ] : [
    AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: rate,
    AVNumberOfChannelsKey: 2, AVLinearPCMBitDepthKey: 16,
    AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false
  ]
  let file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
  let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2)!
  let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096)!
  let chords: [[Double]] = [[130.8128,164.8138,195.9977], [97.9989,123.4708,146.8324],
                           [110,130.8128,164.8138], [87.3071,110,130.8128]]
  var offset = 0
  while offset < Int(seconds * rate) {
    let count = min(4096, Int(seconds * rate) - offset)
    buffer.frameLength = AVAudioFrameCount(count)
    for frame in 0..<count {
      let time = Double(offset + frame) / rate
      let notes = chords[min(3, Int(time / 4))]
      let wave = notes.reduce(0.0) { $0 + sin(2 * .pi * $1 * time) * 0.15 + sin(4 * .pi * $1 * time) * 0.04 }
      buffer.floatChannelData![0][frame] = Float(wave)
      buffer.floatChannelData![1][frame] = Float(wave * 0.8)
    }
    try file.write(from: buffer)
    offset += count
  }
}

func analyze(_ module: OfflineChordAnalysis, _ url: String) -> (Any?, String?) {
  let done = DispatchSemaphore(value: 0)
  var result: Any?
  var code: String?
  module.control.async {
    module.analyzeFile(url, resolver: { result = $0; done.signal() }, rejecter: { value, _, _ in code = value; done.signal() })
  }
  precondition(done.wait(timeout: .now() + 60) == .success, "Analysis did not settle")
  return (result, code)
}
'''
checks = r'''
let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let module = OfflineChordAnalysis()
for aac in [false, true] {
  let file = directory.appendingPathComponent(aac ? "progression.m4a" : "progression.wav")
  try writeAudio(file, aac: aac)
  let (value, code) = analyze(module, file.absoluteString)
  precondition(code == nil, "Decode failed: \(code ?? "unknown")")
  let result = value as! [String: Any]
  precondition(result["engine"] as? String == "chroma-v2", "Stale chord core linked")
  let duration = result["duration"] as! Double
  precondition(abs(duration - 16) < 0.1)
  precondition((result["elapsedMs"] as! Double) > 0)
  let segments = result["segments"] as! [[String: Any]]
  precondition(!segments.isEmpty && abs((segments.last!["end"] as! Double) - duration) < 0.1)
  precondition(segments.contains { ($0["chord"] as? String) != "N" })
  // This checks the actual Swift -> Rust -> JSON contract for both codecs. It
  // makes no claim about note-transcription accuracy or a detected playing style.
  precondition(result["noteEventsVersion"] as? Int == 1, "Missing/stale note-event schema")
  precondition(result["noteEventsLimit"] as? Int == 24000)
  precondition(result["noteEventsTruncated"] as? Bool == false, "Short fixture was unexpectedly truncated")
  let coverageEnd = result["noteEventsCoverageEnd"] as! Double
  precondition(coverageEnd.isFinite && coverageEnd == duration, "Complete note coverage differs from serialized duration")
  let notes = result["noteEvents"] as! [[String: Any]]
  precondition(!notes.isEmpty && notes.count <= 24000, "Expected bounded note events from the multi-tone fixture")
  var previous: (start: Double, midi: Int, end: Double)?
  var endByPitch: [Int: Double] = [:]
  for note in notes {
    let start = note["start"] as! Double, end = note["end"] as! Double
    let midi = note["midi"] as! Int
    let noteEvidence = note["noteEvidence"] as! Double
    let onsetEvidence = note["onsetEvidence"] as! Double
    precondition(start.isFinite && end.isFinite && start >= 0 && end > start && end <= duration)
    precondition((21...108).contains(midi))
    precondition(noteEvidence.isFinite && (0...1).contains(noteEvidence))
    precondition(onsetEvidence.isFinite && (0...1).contains(onsetEvidence))
    if let previous = previous {
      precondition(start > previous.start || (start == previous.start &&
        (midi > previous.midi || (midi == previous.midi && end >= previous.end))),
        "Note events are not sorted by start, MIDI and end")
    }
    if let priorEnd = endByPitch[midi] {
      precondition(start >= priorEnd, "Repeated notes of the same MIDI pitch overlap")
    }
    endByPitch[midi] = end
    previous = (start, midi, end)
  }
}
precondition(analyze(module, "https://example.com/song.mp3").1 == "FileUnavailable")
let short = directory.appendingPathComponent("short.wav")
try writeAudio(short, aac: false, seconds: 0.25)
precondition(analyze(module, short.absoluteString).1 == "AudioTooShort")
let done = DispatchSemaphore(value: 0), cancelled = DispatchSemaphore(value: 0)
module.control.async {
  module.analyzeFile(directory.appendingPathComponent("progression.wav").absoluteString,
    resolver: { _ in fatalError("Cancelled result was published") },
    rejecter: { code, _, _ in precondition(code == "Cancelled"); done.signal() })
  module.analyzeFile(short.absoluteString, resolver: { _ in fatalError("Concurrent job accepted") },
    rejecter: { code, _, _ in precondition(code == "Busy") })
  module.cancel({ _ in cancelled.signal() }, rejecter: { _, _, _ in fatalError("Cancellation failed") })
}
precondition(cancelled.wait(timeout: .now() + 2) == .success)
precondition(done.wait(timeout: .now() + 2) == .success)
precondition(analyze(module, short.absoluteString).1 == "AudioTooShort", "Cancelled job blocks retry")

// A provider that ignores cancellation may keep its worker; its logical session must settle.
let blocked = ChordAnalysisSession()
blocked.didStart()
let detached = DispatchSemaphore(value: 0)
DispatchQueue.global().async {
  do { _ = try blocked.awaitResult(); fatalError("Cancelled provider published") }
  catch { precondition((error as NSError).domain == "Cancelled"); detached.signal() }
}
blocked.stop()
precondition(detached.wait(timeout: .now() + 1) == .success)
blocked.complete(["late": true], error: nil)
do { try blocked.check(); fatalError("Late completion revived a session") }
catch { precondition((error as NSError).domain == "Cancelled") }

for rate in [8000.0, 16000, 22050, 44100, 48000, 96000, 192000, 384000] {
  var count = 0
  let stream = ChordPCMStream(rate: rate) { _, frames in precondition((1...4096).contains(frames)); count += frames }
  for _ in 0..<Int(rate * 2) { try stream.append(1000) }
  try stream.finish()
  precondition(count == 32000 && stream.outputFrames == 32000)
}
print("Production Swift offline analysis passed: real stereo WAV/AAC decode and Rust core, full timeline, URI/short-file errors, Busy, cancellation, blocked-provider detachment, retry and eight sample rates.")
'''

subprocess.run(["cargo", "build", "--release", "--locked", "--lib", "--manifest-path",
                str(root / "android/song-fingerprint/Cargo.toml")], check=True)
target = Path(os.environ.get("CARGO_TARGET_DIR", root / "android/song-fingerprint/target"))
with tempfile.TemporaryDirectory(prefix="freetune-chords-") as directory:
    temporary = Path(directory)
    (temporary / "Probe.swift").write_text(fixture + source + checks, encoding="utf-8")
    subprocess.run(["swiftc", str(temporary / "Probe.swift"), "-import-objc-header",
                    str(root / "ios/freetune-Bridging-Header.h"),
                    str(target / "release/libfreetune_song_fingerprint.a"),
                    "-o", str(temporary / "probe")], check=True)
    subprocess.run([str(temporary / "probe"), directory], check=True, timeout=120)
