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
    production = "\n".join(method(source, name) for name in ["reserveRecordingURL", "localFile", "reconcileRecordings", "removeRecordingFiles"])
    streaming = source[source.index("private final class StreamingTake {"):]
    streaming = streaming.replace("private ", "").replace("AVAudioEngine", "CaptureEngine")
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
try Data("saved recording".utf8).write(to: path(100))
try Data("recoverable partial".utf8).write(to: path(101, partial: true))
store.processing.insert(path(102).path)
store.recorder = Recorder(path(103))
let reserved = try store.reserveRecordingURL("1", timestamp: 100)
precondition(reserved == path(104))
let secondReservation = try store.reserveRecordingURL("1", timestamp: 104)
precondition(secondReservation == path(105))
let savedRecording = try Data(contentsOf: path(100))
let savedPartial = try Data(contentsOf: path(101, partial: true))
precondition(savedRecording == Data("saved recording".utf8))
precondition(savedPartial == Data("recoverable partial".utf8))
try files.removeItem(at: reserved)
try files.removeItem(at: secondReservation)
try files.removeItem(at: path(100))
try files.removeItem(at: path(101, partial: true))
store.processing.removeAll()
store.recorder = nil
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
let marker = path(2).deletingPathExtension().appendingPathExtension("interrupted")
precondition(files.fileExists(atPath: marker.path), "Recovered take lost its interruption marker")
try store.removeRecordingFiles(path(2))
precondition(!files.fileExists(atPath: marker.path))
let orphan = path(99).deletingPathExtension().appendingPathExtension("interrupted")
try Data().write(to: orphan)
try store.reconcileRecordings()
precondition(!files.fileExists(atPath: orphan.path))
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
    swift += r'''
final class CaptureInput {
    var callback: ((AVAudioPCMBuffer, Any?) -> Void)?
    func outputFormat(forBus: Int) -> AVAudioFormat { AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)! }
    func installTap(onBus: Int, bufferSize: Int, format: AVAudioFormat, block: @escaping (AVAudioPCMBuffer, Any?) -> Void) {
        precondition(callback == nil); callback = block
    }
    func removeTap(onBus: Int) { precondition(callback != nil); callback = nil }
}
final class CaptureEngine {
    let inputNode = CaptureInput()
    func prepare() {}
    func start() throws {}
    func stop() {}
}
''' + streaming + r'''
func finish(_ take: StreamingTake, interrupted: Bool) -> Result<Bool, Error> {
    var result: Result<Bool, Error>?
    take.finish(interrupted: interrupted) { result = $0 }
    let deadline = Date().addingTimeInterval(10)
    while result == nil && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.01))
    }
    precondition(result != nil, "Streaming finalization did not finish")
    return result!
}
func capture(_ id: Int, frames: Int) throws -> StreamingTake {
    let url = try store.reserveRecordingURL("1", timestamp: Int64(id))
    let take = try StreamingTake(url: url)
    try take.start()
    var position = 0
    while position < frames {
        let count = min(2048, frames - position)
        let buffer = AVAudioPCMBuffer(pcmFormat: take.engine.inputNode.outputFormat(forBus: 0), frameCapacity: AVAudioFrameCount(count))!
        buffer.frameLength = AVAudioFrameCount(count)
        for index in 0..<count {
            buffer.floatChannelData![0][index] = Float(0.2 * sin(2 * Double.pi * 220 * Double(position + index) / 44100))
        }
        take.engine.inputNode.callback?(buffer, nil)
        take.queue.sync {}
        position += count
    }
    return take
}
let normal = try capture(200, frames: 44100)
precondition(abs(normal.currentTime - 1) < 0.001)
let normalInterrupted = try finish(normal, interrupted: false).get()
precondition(!normalInterrupted)
let saved = try AVAudioFile(forReading: normal.url)
precondition(saved.processingFormat.channelCount == 2)
precondition(abs(Double(saved.length) / saved.processingFormat.sampleRate - 2) < 0.1, "Effect tail or input frames were lost")
precondition(!files.fileExists(atPath: normal.marker.path) && !files.fileExists(atPath: normal.output.path))
let rendered = AVAudioPCMBuffer(pcmFormat: saved.processingFormat, frameCapacity: AVAudioFrameCount(saved.length))!
try saved.read(into: rendered)
var peak: Float = 0, stereoDifference: Float = 0
for index in 0..<Int(rendered.frameLength) {
    let left = rendered.floatChannelData![0][index], right = rendered.floatChannelData![1][index]
    precondition(left.isFinite && right.isFinite)
    peak = max(peak, max(abs(left), abs(right)))
    stereoDifference += abs(left - right)
}
precondition(peak > 0.01 && peak < 1 && stereoDifference > 0.01)
let interrupted = try capture(201, frames: 22050)
let interruptedFlag = try finish(interrupted, interrupted: true).get()
precondition(interruptedFlag)
let partial = try AVAudioFile(forReading: interrupted.url)
precondition(abs(Double(partial.length) / partial.processingFormat.sampleRate - 0.5) < 0.1)
precondition(files.fileExists(atPath: interrupted.marker.path))
try store.reconcileRecordings()
precondition(files.fileExists(atPath: interrupted.url.path))
try store.removeRecordingFiles(interrupted.url)
precondition(!files.fileExists(atPath: interrupted.marker.path))
let short = try capture(202, frames: 1024)
if case .success = finish(short, interrupted: true) { fatalError("Empty take was saved") }
precondition(!files.fileExists(atPath: short.url.path) && !files.fileExists(atPath: short.output.path) && !files.fileExists(atPath: short.marker.path))
print("Production streaming recording passed: real stereo AAC, finite audible samples, stereo room effect, natural tail, interrupted finalization and short-take cleanup.")
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
