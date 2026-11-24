"""Exercise production Swift string ownership with deterministic audio doubles.

No device audio or playback-latency claim is made. A full iOS build separately
checks the real AVFoundation signatures; this probe checks command ordering.
"""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def method(source, name, prefix="@objc"):
    start = source.index(f"    {prefix} func {name}(")
    opening = source.index("{", start)
    depth = 1
    end = opening + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end].replace(f"{prefix} ", "", 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path)
    args = parser.parse_args()
    compiler = shutil.which("swiftc")
    if not compiler:
        raise SystemExit("Requires Swift compiler. No native performance checks ran.")
    root = Path(__file__).resolve().parent
    source = (args.source or root / "ios/PerformanceAudio.swift").read_text(encoding="utf-8")
    production = "\n".join(method(source, name) for name in ["playGuitarString", "stopGuitarString", "stopPlayback", "stopMetronomeBeats", "prepareFingering", "playPreparedGuitar"])
    production += "\n" + method(source, "clearMetronomeBeats", "private")
    production += "\n" + method(source, "cacheGuitar", "private")
    eligibility = next((line for line in source.splitlines() if "private var canPlayInstrument:" in line), "")
    interruption = method(source, "handleInterruption", "private") if "private func handleInterruption(" in source else ""
    foreground = method(source, "handleForeground", "private") if "private func handleForeground(" in source else ""
    swift = r'''
import Foundation
typealias RCTPromiseResolveBlock = (Any?) -> Void
typealias RCTPromiseRejectBlock = (String?, String?, Error?) -> Void
let AVAudioSessionInterruptionTypeKey = "type"
let AVAudioSessionInterruptionWasSuspendedKey = "suspended"

struct DispatchTime {
    let seconds: Double
    static func now() -> DispatchTime { DispatchTime(seconds: DispatchQueue.main.time) }
    static func + (time: DispatchTime, delay: Double) -> DispatchTime {
        DispatchTime(seconds: time.seconds + delay)
    }
}
final class DispatchQueue {
    static let main = DispatchQueue()
    var time = 0.0
    private var work: [(Double, Int, () -> Void)] = []
    private var serial = 0
    func asyncAfter(deadline: DispatchTime, execute: @escaping () -> Void) {
        serial += 1
        work.append((deadline.seconds, serial, execute))
    }
    func advance(_ seconds: Double) {
        let end = time + seconds
        while true {
            work.sort { $0.0 == $1.0 ? $0.1 < $1.1 : $0.0 < $1.0 }
            guard let first = work.first, first.0 <= end else { break }
            work.removeFirst()
            time = first.0
            first.2()
        }
        time = end
    }
    func async(execute: () -> Void) { execute() }
    func reset() { work.removeAll(); time = 0 }
}
final class AVAudioPlayer {
    init() {}
    init(data: Data) throws {}
    func prepareToPlay() -> Bool { true }
    var currentTime = 0.0
    var volume: Float = 1
    var isPlaying = false
    var plays = 0
    var stops = 0
    var fades: [(Float, Double)] = []
    var pendingFade: Float?
    func setVolume(_ target: Float, fadeDuration: Double) {
        fades.append((target, fadeDuration))
        if fadeDuration == 0 {
            volume = target
            pendingFade = nil
        } else { pendingFade = target }
    }
    @discardableResult func play() -> Bool { plays += 1; isPlaying = true; return true }
    func stop() { stops += 1; isPlaying = false }
}
final class AudioEngine {
    var pauses = 0
    var stops = 0
    func pause() { pauses += 1 }
    func stop() { stops += 1 }
}
final class AVAudioSession {
    enum InterruptionType: UInt { case ended = 0, began = 1 }
    enum Category { case playback, playAndRecord }
    enum Mode { case `default` }
    enum Option: Hashable { case mixWithOthers }
    struct SetActiveOptions: OptionSet {
        let rawValue: Int
        static let notifyOthersOnDeactivation = SetActiveOptions(rawValue: 1)
    }
    enum Failure: Error { case denied }
    static let instance = AVAudioSession()
    var category = Category.playback
    var deny = false
    var activations = 0
    static func sharedInstance() -> AVAudioSession { instance }
    func setCategory(_ category: Category, mode: Mode, options: Set<Option>) throws {
        if deny { throw Failure.denied }
    }
    func setActive(_ active: Bool, options: SetActiveOptions = []) throws {
        if deny { throw Failure.denied }
        if active { activations += 1 }
    }
}
final class UIApplication {
    enum State { case active, inactive, background }
    static let shared = UIApplication()
    var applicationState = State.active
}
final class StringPlayer {
    var recorder: Any?
    var player: AVAudioPlayer?
    var cue: AVAudioPlayer?
    var preparedStrings: [String: AVAudioPlayer] = [:]
    var preparedAlternates: [String: AVAudioPlayer] = [:]
    var preparedSizes: [String: Int] = [:]
    var preparedStringOrder: [String] = []
    let worker = DispatchQueue.main
    var guitarStrings: [Int: AVAudioPlayer] = [:]
    var stringGeneration: [Int: Int] = [:]
    var stringSessionActive = false
    var instrumentInterrupted = false
    var events: [String] = []
    var captureStops = 0
    var metronomeNode: AVAudioPlayer?
    var metronomeEngine: AudioEngine?
    var beatNodes: [AVAudioPlayer] = []
    var beatEngine: AudioEngine?
    var beatBuffers: [Int] = []
    func finishTake() { captureStops += 1 }
    func emit(_ state: String) { events.append(state) }
''' + eligibility + "\n" + production + "\n" + interruption + "\n" + foreground + r'''
}

func fresh() -> (StringPlayer, AVAudioPlayer, AVAudioPlayer) {
    DispatchQueue.main.reset()
    AVAudioSession.instance.deny = false
    AVAudioSession.instance.activations = 0
    UIApplication.shared.applicationState = .active
    let player = StringPlayer()
    let first = AVAudioPlayer()
    let second = AVAudioPlayer()
    player.preparedStrings = ["first": first, "second": second]
    return (player, first, second)
}

// One tick at quarter BPM400 lasts 6.25ms. The command must start its voice
// before the transport releases it; a deferred 10ms attack loses this note.
do {
    let (player, first, _) = fresh()
    player.playGuitarString("first", index: 0)
    precondition(first.plays == 1, "A short note's attack was deferred")
    DispatchQueue.main.advance(0.00625)
    player.stopGuitarString(0)
    DispatchQueue.main.advance(0.1)
    precondition(first.plays == 1 && !first.isPlaying, "Released note started late")
    precondition(player.guitarStrings.isEmpty)
}
// A scheduled release from an earlier gate must not stop a new attack that
// reuses the same prepared player on the same physical string.
do {
    let (player, first, _) = fresh()
    player.playGuitarString("first", index: 0)
    player.stopGuitarString(0)
    precondition(first.pendingFade == 0)
    DispatchQueue.main.advance(0.005)
    player.playGuitarString("first", index: 0)
    let stops = first.stops
    DispatchQueue.main.advance(0.1)
    precondition(first.plays == 2 && first.isPlaying && first.stops == stops)
    precondition(first.fades.last!.0 == 0.22 && first.fades.last!.1 == 0)
    precondition(first.pendingFade == nil, "A previous release fade was not cancelled")
}
// Repeated notes and A -> B -> A transitions retain only the current voice;
// deferred cleanup cannot silence a player that has become current again.
do {
    let (player, first, second) = fresh()
    player.playGuitarString("first", index: 0)
    player.playGuitarString("first", index: 0)
    precondition(first.plays == 2 && first.stops == 1)
    player.playGuitarString("second", index: 0)
    DispatchQueue.main.advance(0.005)
    player.playGuitarString("first", index: 0)
    let stops = first.stops
    DispatchQueue.main.advance(0.1)
    precondition(first.plays == 3 && first.isPlaying && first.stops == stops)
    precondition(!second.isPlaying && player.guitarStrings[0] === first)
    precondition(AVAudioSession.instance.activations == 1)
}
// Each physical string remains independent.
do {
    let (player, first, second) = fresh()
    player.playGuitarString("first", index: 0)
    player.playGuitarString("second", index: 5)
    player.stopGuitarString(0)
    DispatchQueue.main.advance(0.1)
    precondition(!first.isPlaying && second.isPlaying)
    precondition(player.guitarStrings[5] === second)
}
// Dedicated beat-stop keeps guitar and click caches intact; global stop owns
// the full cleanup and must leave no delayed attack able to restart a voice.
do {
    let (player, first, second) = fresh()
    let engine = AudioEngine()
    let click = AVAudioPlayer()
    player.beatEngine = engine
    player.beatNodes = [click]
    player.beatBuffers = [1, 2, 3]
    click.play()
    player.playGuitarString("first", index: 0)
    player.stopMetronomeBeats()
    precondition(first.isPlaying && !click.isPlaying && engine.pauses == 1 && engine.stops == 0)
    precondition(player.beatBuffers == [1, 2, 3] && player.beatNodes.count == 1)
    player.playGuitarString("second", index: 0)
    player.stopPlayback()
    precondition(player.guitarStrings.isEmpty && !second.isPlaying && !player.stringSessionActive)
    precondition(player.beatNodes.isEmpty && player.beatBuffers.isEmpty && player.beatEngine == nil)
    precondition(engine.stops == 1)
    DispatchQueue.main.advance(0.1)
    precondition(!first.isPlaying && !second.isPlaying && first.plays == 1 && second.plays == 1)
    precondition(player.events.isEmpty, "An ordinary stop must not emit an interruption")
}
// Native microphone capture, bad indices and session-activation failures
// must never start, enqueue or claim a guitar voice.
do {
    let (player, first, second) = fresh()
    player.recorder = true
    player.playGuitarString("first", index: 0)
    player.recorder = nil
    player.playGuitarString("first", index: -1)
    player.playGuitarString("first", index: 6)
    player.playGuitarString("missing", index: 0)
    precondition(AVAudioSession.instance.activations == 0)
    AVAudioSession.instance.deny = true
    player.playGuitarString("second", index: 0)
    DispatchQueue.main.advance(0.1)
    precondition(first.plays == 0 && second.plays == 0 && player.guitarStrings.isEmpty)
}
// A command already queued on the native bridge must not restart guitar
// playback after the app leaves the foreground, even before JS sees AppState.
do {
    let (player, first, _) = fresh()
    for state in [UIApplication.State.inactive, .background] {
        UIApplication.shared.applicationState = state
        player.playGuitarString("first", index: 0)
        DispatchQueue.main.advance(0.1)
        precondition(first.plays == 0 && player.guitarStrings.isEmpty)
        precondition(AVAudioSession.instance.activations == 0)
    }
    UIApplication.shared.applicationState = .active
    player.playGuitarString("first", index: 0)
    precondition(first.plays == 1)
}
''' + (r'''
// A foreground OS interruption must stop playback and notify JS only once at
// its beginning. Ending it permits a future explicit Play without starting one.
do {
    let (player, first, _) = fresh()
    player.playGuitarString("first", index: 0)
    player.handleInterruption(Notification(name: Notification.Name("interruption"), userInfo: [AVAudioSessionInterruptionTypeKey: UInt(1)]))
    precondition(player.events == ["playbackInterrupted"] && !first.isPlaying && player.captureStops == 1)
    player.playGuitarString("first", index: 0)
    DispatchQueue.main.advance(0.1)
    precondition(first.plays == 1 && player.guitarStrings.isEmpty)
    player.handleInterruption(Notification(name: Notification.Name("interruption"), userInfo: [AVAudioSessionInterruptionTypeKey: UInt(0)]))
    DispatchQueue.main.advance(0.1)
    precondition(first.plays == 1 && player.events == ["playbackInterrupted"] && player.captureStops == 1)
    player.playGuitarString("first", index: 0)
    precondition(first.plays == 2)
}
''' if interruption else "") + (r'''
// Apple does not guarantee an .ended event. Foreground restores permission
// only; an explicit new Play performs activation and may still be denied.
do {
    let (player, first, _) = fresh()
    player.playGuitarString("first", index: 0)
    player.handleInterruption(Notification(name: Notification.Name("interruption"), userInfo: [AVAudioSessionInterruptionTypeKey: UInt(1)]))
    UIApplication.shared.applicationState = .inactive
    player.handleForeground()
    precondition(player.instrumentInterrupted)
    UIApplication.shared.applicationState = .background
    player.handleForeground()
    player.playGuitarString("first", index: 0)
    precondition(player.instrumentInterrupted && first.plays == 1)
    UIApplication.shared.applicationState = .active
    player.handleForeground()
    DispatchQueue.main.advance(0.1)
    precondition(!player.instrumentInterrupted && first.plays == 1 && !first.isPlaying)
    precondition(AVAudioSession.instance.activations == 1 && !player.stringSessionActive)
    AVAudioSession.instance.deny = true
    player.playGuitarString("first", index: 0)
    precondition(first.plays == 1 && player.guitarStrings.isEmpty)
    AVAudioSession.instance.deny = false
    player.playGuitarString("first", index: 0)
    precondition(first.plays == 2 && AVAudioSession.instance.activations == 2)
}
// A delayed suspension-began notification after foreground must not latch
// playback off permanently either, and still must not activate/play anything.
do {
    let (player, first, _) = fresh()
    player.handleForeground()
    player.handleInterruption(Notification(name: Notification.Name("interruption"), userInfo: [AVAudioSessionInterruptionTypeKey: UInt(1), AVAudioSessionInterruptionWasSuspendedKey: true]))
    DispatchQueue.main.advance(0.1)
    precondition(!player.instrumentInterrupted && first.plays == 0)
    precondition(AVAudioSession.instance.activations == 0 && player.events == ["playbackInterrupted"])
    player.playGuitarString("first", index: 0)
    precondition(first.plays == 1)
}
''' if foreground else "") + r'''
do {
    let (player, _, _) = fresh()
    var ready = false
    player.prepareFingering("chord", wave: "AAAA", resolver: { ready = $0 as? Bool == true }, rejecter: { _, _, _ in fatalError("Preparation failed") })
    precondition(ready && player.preparedAlternates["chord"] != nil)
    player.playPreparedGuitar("chord")
    let first = player.cue!
    player.playPreparedGuitar("chord")
    let second = player.cue!
    precondition(first !== second && first.plays == 1 && second.plays == 1)
    DispatchQueue.main.advance(0.005)
    player.playPreparedGuitar("chord")
    DispatchQueue.main.advance(0.1)
    precondition(player.cue === first && first.isPlaying && first.plays == 2 && !second.isPlaying)
    for index in 0..<33 {
        player.prepareFingering("note-\(index)", wave: "AAAA", resolver: { precondition($0 as? Bool == true) }, rejecter: { _, _, _ in fatalError("Preparation failed") })
    }
    player.prepareFingering("chord", wave: "", resolver: { ready = $0 as? Bool == true }, rejecter: { _, _, _ in fatalError("Cache lookup failed") })
    precondition(!ready && player.preparedStrings["chord"] == nil && player.preparedAlternates["chord"] == nil)
    player.stopPlayback()
    player.playPreparedGuitar("missing")
    precondition(player.cue == nil)
    player.prepareFingering("chord", wave: "AAAA", resolver: { ready = $0 as? Bool == true }, rejecter: { _, _, _ in fatalError("Rebuild failed") })
    player.playPreparedGuitar("chord")
    precondition(ready && player.cue?.plays == 1)
}
print("Production Swift performance checks passed: short attacks, stale releases, retriggers, voice/click ownership and capture/session/foreground/interruption guards.")
print("Deterministic audio doubles only; no hardware playback or latency was measured.")
'''
    with tempfile.TemporaryDirectory(prefix="guitar-performance-", dir=os.environ.get("TMPDIR")) as directory:
        temporary = Path(directory)
        main_file = temporary / "main.swift"
        main_file.write_text(swift, encoding="utf-8")
        binary = temporary / "performance-check"
        environment = {**os.environ, "CLANG_MODULE_CACHE_PATH": str(temporary / "modules")}
        subprocess.run([compiler, "-module-cache-path", str(temporary / "modules"), str(main_file), "-o", str(binary)], check=True, env=environment)
        subprocess.run([str(binary)], check=True, env=environment)


if __name__ == "__main__":
    main()
