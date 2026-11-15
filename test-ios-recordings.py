"""Exercise production iOS recording-file methods on macOS with real AAC fixtures."""
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile


def main():
    compiler = shutil.which("swiftc")
    if sys.platform != "darwin" or not compiler:
        raise SystemExit("Requires macOS with Swift and AVFoundation. No recording checks ran.")
    root = Path(__file__).resolve().parent
    method = runpy.run_path(str(root / "test-ios-pitch.py"))["method"]
    source = (root / "ios/PerformanceAudio.swift").read_text(encoding="utf-8")
    production = "\n".join(method(source, name) for name in ["localFile", "reconcileRecordings", "removeRecordingFiles"])
    swift = """import Foundation
import AVFoundation
class Recorder { var url: URL; init(_ url: URL) { self.url = url } }
class Store {
    let directory: URL
    var processing = Set<String>()
    var recorder: Recorder?
    init(_ url: URL) { directory = url }
""" + production + "\n}\n" + r'''
let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let files = FileManager.default
let store = Store(directory)
try files.createDirectory(at: directory, withIntermediateDirectories: true)
func audio(_ url: URL) throws {
    let output = try AVAudioFile(forWriting: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1])
    let buffer = AVAudioPCMBuffer(pcmFormat: output.processingFormat, frameCapacity: 4410)!
    buffer.frameLength = 4410
    for i in 0..<4410 { buffer.floatChannelData![0][i] = Float(0.2 * sin(2 * Double.pi * 220 * Double(i) / 44100)) }
    try output.write(from: buffer)
}
func path(_ id: Int, partial: Bool = false) -> URL { directory.appendingPathComponent("song-1-\(id)\(partial ? ".processing" : "").m4a") }
try Data().write(to: path(1))
try Data("incomplete".utf8).write(to: path(1, partial: true))
try store.reconcileRecordings()
precondition(!files.fileExists(atPath: path(1).path) && !files.fileExists(atPath: path(1, partial: true).path))
try Data().write(to: path(2))
try audio(path(2, partial: true))
try store.reconcileRecordings()
let recovered = try AVAudioFile(forReading: path(2))
precondition(recovered.length > 0)
precondition(!files.fileExists(atPath: path(2, partial: true).path))
try audio(path(3))
let original = try Data(contentsOf: path(3))
try Data("incomplete".utf8).write(to: path(3, partial: true))
try store.reconcileRecordings()
let retained = try Data(contentsOf: path(3))
precondition(retained == original)
precondition(!files.fileExists(atPath: path(3, partial: true).path))
try Data().write(to: path(4))
try Data("active".utf8).write(to: path(4, partial: true))
store.processing.insert(path(4).path)
try store.reconcileRecordings()
precondition(files.fileExists(atPath: path(4).path) && files.fileExists(atPath: path(4, partial: true).path))
do { try store.removeRecordingFiles(path(4)); preconditionFailure("Deleted active processing") } catch {}
store.processing.removeAll()
store.recorder = Recorder(path(4))
try store.reconcileRecordings()
precondition(files.fileExists(atPath: path(4).path) && files.fileExists(atPath: path(4, partial: true).path))
store.recorder = nil
try store.removeRecordingFiles(store.localFile(path(4).path))
precondition(!files.fileExists(atPath: path(4).path) && !files.fileExists(atPath: path(4, partial: true).path))
try store.removeRecordingFiles(path(4))
print("Production Swift recording methods passed: invalid cleanup, real AAC recovery, original preservation, active processing/capture protection, family deletion and idempotent retry.")
print("No microphone hardware or full iOS app was exercised.")
'''
    with tempfile.TemporaryDirectory(prefix="guitar-recordings-", dir=os.environ.get("TMPDIR")) as directory:
        temporary = Path(directory)
        main_file = temporary / "main.swift"
        main_file.write_text(swift, encoding="utf-8")
        binary = temporary / "recording-check"
        environment = {**os.environ, "CLANG_MODULE_CACHE_PATH": str(temporary / "modules")}
        subprocess.run([compiler, "-O", "-module-cache-path", str(temporary / "modules"), str(main_file), "-o", str(binary)], check=True, env=environment)
        subprocess.run([str(binary), str(temporary / "recordings")], check=True, env=environment)


if __name__ == "__main__":
    main()
