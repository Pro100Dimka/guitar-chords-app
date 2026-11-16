"""Exercise production Swift capture methods against deterministic route fixtures."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def method(source, name):
    start = source.index(f"    func {name}(")
    opening = source.index("{", start)
    end, depth = opening + 1, 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end].replace("AVAudioSession", "CaptureSession").replace("AVAudioEngine", "CaptureEngine").replace("AVAudioFrameCount", "UInt32")


def main():
    compiler = shutil.which("swiftc")
    if sys.platform != "darwin" or not compiler:
        raise SystemExit("Requires macOS with Swift and AVFoundation. No capture checks ran.")
    source = (Path(__file__).resolve().parent / "ios/MicrophoneStreamModule.swift").read_text(encoding="utf-8")
    fixture = r'''
import Foundation
import AVFoundation
struct CaptureFormat { let sampleRate: Double; let channelCount: UInt32 }
enum Route {
    static let valid = CaptureFormat(sampleRate: 48000, channelCount: 1)
    static var hardware = valid, tap = valid
    static var available = true, active = false, failActivation = false, failStart = false
    static var taps = 0, removals = 0, starts = 0
    static func reset() {
        hardware = valid; tap = valid; available = true; active = false
        failActivation = false; failStart = false; taps = 0; removals = 0; starts = 0
    }
}
final class CaptureSession {
    enum Category { case playAndRecord }
    enum Mode { case measurement }
    struct Options: OptionSet {
        let rawValue: Int
        static let defaultToSpeaker = Options(rawValue: 1)
        static let notifyOthersOnDeactivation = Options(rawValue: 2)
    }
    static let shared = CaptureSession()
    static func sharedInstance() -> CaptureSession { shared }
    var isInputAvailable: Bool { Route.available }
    func setCategory(_ category: Category, mode: Mode, options: Options) throws {}
    func setActive(_ active: Bool, options: Options = []) throws {
        if active && Route.failActivation { Route.active = true; throw NSError(domain: "route", code: 1) }
        Route.active = active
    }
}
final class CaptureInput {
    var installed = false
    func inputFormat(forBus bus: Int) -> CaptureFormat { Route.hardware }
    func outputFormat(forBus bus: Int) -> CaptureFormat { Route.tap }
    func installTap(onBus: Int, bufferSize: UInt32, format: CaptureFormat,
                    block: @escaping (AVAudioPCMBuffer, Any?) -> Void) {
        precondition(!installed); installed = true; Route.taps += 1
    }
    func removeTap(onBus: Int) {
        precondition(installed, "Removed a tap that was never installed")
        installed = false; Route.removals += 1
    }
}
final class CaptureEngine {
    let inputNode = CaptureInput()
    func start() throws {
        if Route.failStart { throw NSError(domain: "engine", code: 1) }
        Route.starts += 1
    }
    func stop() {}
}
final class CaptureProbe {
    static let BUF_PER_SEC = 15
    var sampleRate = 44100.0
    var audioEngine: CaptureEngine?, inputNode: CaptureInput?
    var isRecording = false, tapInstalled = false
    let processingLock = NSLock()
    let targetNotes: [Int] = []
    func resetPitch() {}
    func estimatePitch(_ samples: [Float], sampleRate: Double) -> Float { 0 }
    func smoothPitch(_ pitch: Float) -> Float { pitch }
    func frequencyToNoteData(_ pitch: Float) -> [String: Any] { [:] }
    func sendEvent(_ name: String, body: [String: Any]) {}
'''
    fixture += "typealias RCTPromiseResolveBlock = (Any?) -> Void\ntypealias RCTPromiseRejectBlock = (String?, String?, Error?) -> Void\n"
    fixture += method(source, "startRecording") + "\n" + method(source, "stopRecording") + "\n" + method(source, "restartRecording") + "\n}\n"
    fixture += r'''
func assertStopped(_ probe: CaptureProbe) {
    precondition(!probe.isRecording && probe.audioEngine == nil && probe.inputNode == nil)
    precondition(!probe.tapInstalled && !Route.active)
}
for scenario in 0..<7 {
    Route.reset()
    switch scenario {
    case 0: Route.available = false
    case 1: Route.hardware = CaptureFormat(sampleRate: 0, channelCount: 1)
    case 2: Route.hardware = CaptureFormat(sampleRate: 48000, channelCount: 0)
    case 3: Route.tap = CaptureFormat(sampleRate: 0, channelCount: 1)
    case 4: Route.tap = CaptureFormat(sampleRate: 48000, channelCount: 0)
    case 5: Route.hardware = CaptureFormat(sampleRate: .nan, channelCount: 1)
    default: Route.tap = CaptureFormat(sampleRate: .infinity, channelCount: 1)
    }
    let probe = CaptureProbe()
    probe.startRecording()
    precondition(Route.taps == 0 && Route.removals == 0 && Route.starts == 0,
                 "Unavailable route installed an input tap: (scenario)")
    assertStopped(probe)
    Route.available = true; Route.hardware = Route.valid; Route.tap = Route.valid
    probe.startRecording()
    precondition(probe.isRecording && Route.taps == 1 && Route.starts == 1)
    probe.startRecording()
    precondition(Route.taps == 1, "Repeated start installed a second tap")
    probe.stopRecording(); probe.stopRecording()
    precondition(Route.removals == 1)
    assertStopped(probe)
}
for activation in [true, false] {
    Route.reset(); Route.failActivation = activation; Route.failStart = !activation
    let probe = CaptureProbe()
    probe.startRecording()
    assertStopped(probe)
    precondition(Route.removals == (activation ? 0 : 1))
    Route.failActivation = false; Route.failStart = false
    probe.startRecording()
    precondition(probe.isRecording)
    probe.stopRecording(); assertStopped(probe)
}
Route.reset()
let recovery = CaptureProbe()
recovery.startRecording()
recovery.restartRecording({ precondition(($0 as? Bool) == true) }, rejecter: { _, _, _ in preconditionFailure() })
precondition(Route.removals == 1 && Route.taps == 2 && Route.starts == 2)
Route.available = false
recovery.restartRecording({ precondition(($0 as? Bool) == false) }, rejecter: { _, _, _ in preconditionFailure() })
assertStopped(recovery)
print("Production Swift capture methods passed unavailable/invalid routes, acknowledged recovery, repeated start/stop, activation failure and engine failure using route fixtures.")
print("No physical microphone, full iOS app or real AVAudioSession integration was tested.")
'''
    with tempfile.TemporaryDirectory(prefix="guitar-capture-", dir=os.environ.get("TMPDIR")) as directory:
        temporary = Path(directory)
        swift = temporary / "main.swift"
        swift.write_text(fixture, encoding="utf-8")
        binary = temporary / "capture-check"
        environment = {**os.environ, "CLANG_MODULE_CACHE_PATH": str(temporary / "modules")}
        subprocess.run([compiler, "-O", "-module-cache-path", str(temporary / "modules"), str(swift), "-o", str(binary)], check=True, env=environment)
        subprocess.run([str(binary)], check=True, env=environment)


if __name__ == "__main__":
    main()
