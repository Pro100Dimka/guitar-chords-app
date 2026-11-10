"""Compile and exercise the actual iOS pitch methods on macOS, without React Native."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def method(source, name):
    start = source.index(f"    private func {name}(")
    opening = source.index("{", start)
    depth = 1
    end = opening + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end].replace("private func", "func", 1)


def main():
    compiler = shutil.which("swiftc")
    if sys.platform != "darwin" or not compiler:
        raise SystemExit("Requires macOS with Xcode/Swift and Accelerate. No iOS checks ran.")
    root = Path(__file__).resolve().parent
    source = (root / "ios/MicrophoneStreamModule.swift").read_text(encoding="utf-8")
    detector = "import Foundation\nimport Accelerate\nimport AVFoundation\nclass Detector {\nvar pitchHistory: [Float] = []\nvar previousRms = 0.0\nvar pendingPitch: Float = 0\nvar missingFrames = 0\n"
    detector += method(source, "estimatePitch") + "\n" + method(source, "smoothPitch") + "\n" + method(source, "resetPitch") + "\n}\n"
    driver = r'''
let detector = Detector()
var cases = 0
var worst = 0.0
for rate in [44100, 48000] {
    for reference in [73.4162, 82.4069, 110.0, 146.8324, 195.9977, 246.9417, 329.6276, 440.0, 987.7666] {
        for detune in [-50, -10, 0, 10, 50] {
            let frequency = reference * pow(2, Double(detune) / 1200)
            for harmonics in 0...2 {
                var seed: UInt64 = 42
                let samples: [Float] = (0..<(rate / 15)).map { i in
                    let phase = 2 * Double.pi * frequency * Double(i) / Double(rate)
                    let signal: Double
                    switch harmonics {
                    case 1: signal = 0.08 * sin(phase) + 0.35 * sin(2 * phase) + 0.12 * sin(3 * phase)
                    case 2: signal = 0.035 * sin(phase) + 0.35 * sin(2 * phase) + 0.01 * sin(3 * phase)
                    default: signal = 0.4 * sin(phase)
                    }
                    seed = seed &* 6364136223846793005 &+ 1
                    let noise = (Double(seed >> 32) / Double(UInt32.max) - 0.5) * 0.02
                    return Float(signal + noise)
                }
                detector.resetPitch()
                let pitch = Double(detector.estimatePitch(samples, sampleRate: Double(rate)))
                let cents = pitch > 0 ? abs(1200 * log2(pitch / frequency)) : Double.infinity
                precondition(cents < 3, "rate=\(rate), frequency=\(frequency), harmonics=\(harmonics), pitch=\(pitch), error=\(cents)")
                worst = max(worst, cents)
                cases += 1
            }
        }
    }
    let silence = [Float](repeating: 0, count: rate / 15)
    precondition(detector.estimatePitch(silence, sampleRate: Double(rate)) == 0)
    var seed: UInt64 = 7
    let noise: [Float] = (0..<(rate / 15)).map { _ in
        seed = seed &* 6364136223846793005 &+ 1
        return Float(Double(seed >> 32) / Double(UInt32.max) - 0.5) * 0.4
    }
    precondition(detector.estimatePitch(noise, sampleRate: Double(rate)) == 0)
    let quiet: [Float] = (0..<(rate / 15)).map { i in
        Float(0.02 + 0.008 * sin(2 * Double.pi * 82.4069 * Double(i) / Double(rate)))
    }
    let quietPitch = Double(detector.estimatePitch(quiet, sampleRate: Double(rate)))
    precondition(quietPitch > 0 && abs(1200 * log2(quietPitch / 82.4069)) < 3)
}
for _ in 0..<5 { _ = detector.smoothPitch(82.4069) }
_ = detector.smoothPitch(329.6276)
let switched = detector.smoothPitch(329.6276)
precondition(abs(1200 * log2(switched / 329.6276)) < 3)
precondition(detector.smoothPitch(0) == 0)
precondition(detector.smoothPitch(.nan) == 0)
_ = detector.smoothPitch(110)
let adjusted: Float = 110 * pow(2, 10.0 / 1200)
var settled: Float = 0
for _ in 0..<8 { settled = detector.smoothPitch(adjusted) }
precondition(abs(1200 * log2(settled / adjusted)) < 0.5)
func tone(_ frequency: Double, _ rate: Int, _ frame: Int, _ level: Double) -> [Float] {
    (0..<(rate / 15)).map { i in
        let phase = 2 * Double.pi * frequency * Double(frame * (rate / 15) + i) / Double(rate)
        return Float((0.4 * sin(phase) + 0.15 * sin(2 * phase) + 0.06 * sin(3 * phase)) * level)
    }
}
func track(_ samples: [Float], _ rate: Int) -> Double {
    Double(detector.smoothPitch(detector.estimatePitch(samples, sampleRate: Double(rate))))
}
let frequencies = [82.4069, 110.0, 146.8324, 195.9977, 246.9417, 329.6276]
var transitions = 0
for rate in [44100, 48000] {
    for from in frequencies {
        for to in frequencies where from != to {
            for level in [0.3, 1.0, 1.5] {
                detector.resetPitch()
                for frame in 0..<5 { _ = track(tone(from, rate, frame, 1), rate) }
                let pitches = (0..<5).map { track(tone(to, rate, $0 + 5, level), rate) }
                precondition(pitches.dropFirst(2).allSatisfy { $0 > 0 && abs(1200 * log2($0 / to)) < 3 }, "Stuck transition")
                transitions += 1
            }
        }
    }
    for frequency in frequencies {
        detector.resetPitch()
        for frame in 0..<60 {
            let detuned = frequency * pow(2, Double(frame) / 3 / 1200)
            let pitch = track(tone(detuned, rate, frame, exp(-Double(frame) / 20)), rate)
            if frame >= 3 { precondition(pitch > 0 && abs(1200 * log2(pitch / detuned)) < 3, "Decay/drift failed") }
        }
        for _ in 0..<3 { precondition(track([Float](repeating: 0, count: rate / 15), rate) == 0) }
        var restarted = 0.0
        for frame in 0..<3 { restarted = track(tone(440, rate, frame, 0.2), rate) }
        precondition(restarted > 0 && abs(1200 * log2(restarted / 440)) < 3, "Stale state after silence")
    }
}
let directory = URL(fileURLWithPath: CommandLine.arguments[1])
let recordings = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
    .filter { $0.pathExtension == "wav" && $0.lastPathComponent != "nylon_all.wav" }
precondition(recordings.count == 10)
for url in recordings.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
    let file = try AVAudioFile(forReading: url)
    let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length))!
    try file.read(into: buffer)
    let samples = Array(UnsafeBufferPointer(start: buffer.floatChannelData![0], count: Int(buffer.frameLength)))
    let rate = Int(buffer.format.sampleRate)
    let size = rate / 15
    let frames = stride(from: 0, through: samples.count - size, by: size).map { Array(samples[$0..<($0 + size)]) }
    let energy = frames.map { sqrt($0.reduce(0.0) { $0 + Double($1) * Double($1) } / Double(size)) }
    let floor = max(0.01, (energy.max() ?? 0) * 0.1)
    let name = url.lastPathComponent
    let expected: Double
    if name.hasPrefix("1st") { expected = 329.6276 }
    else if name.hasPrefix("5th") { expected = 110 }
    else if name.hasPrefix("6th") { expected = 82.4069 }
    else { expected = 146.8324 }
    detector.resetPitch()
    var locked = false
    var accepted = 0
    var eligible = 0
    var detectedFrames = 0
    for (index, frame) in frames.enumerated() {
        let rawPitch = detector.estimatePitch(frame, sampleRate: Double(rate))
        let pitch = Double(detector.smoothPitch(rawPitch))
        let correct = pitch > 0 && abs(1200 * log2(pitch / expected)) < 100
        if correct { locked = true }
        if energy[index] >= floor {
            eligible += 1
            if rawPitch > 0 { detectedFrames += 1 }
            if pitch > 0 { accepted += 1 }
            precondition(!locked || pitch == 0 || correct, "Decay register jump in \(name) at frame \(index)")
        }
    }
    precondition(locked && accepted >= 10 && Double(accepted) >= Double(detectedFrames) * 0.8, "Insufficient coverage in \(name)")
    print("Recording \(name): no post-acquisition register jumps; accepted \(accepted)/\(eligible) eligible frames")
}
print("\(transitions) transitions and 12 decay/drift sequences passed.")
print("Actual Swift pitch methods: \(cases) signals passed, worst=\(worst) cents; silence, noise, quiet tone, transitions and settling passed.")
print("This does not validate AVAudioSession, microphone hardware, or the full iOS app.")
'''
    with tempfile.TemporaryDirectory(prefix="guitar-pitch-", dir=os.environ.get("TMPDIR")) as directory:
        temporary = Path(directory)
        swift = temporary / "main.swift"
        swift.write_text(detector + driver, encoding="utf-8")
        binary = temporary / "pitch-check"
        environment = {**os.environ, "CLANG_MODULE_CACHE_PATH": str(temporary / "modules")}
        subprocess.run([compiler, "-O", "-module-cache-path", str(temporary / "modules"), str(swift), "-o", str(binary)], check=True, env=environment)
        subprocess.run([str(binary), str(root / "assets/notebooks")], check=True, env=environment)


if __name__ == "__main__":
    main()
