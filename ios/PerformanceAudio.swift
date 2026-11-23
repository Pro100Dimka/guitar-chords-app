import AVFoundation
import Foundation
import React
import UIKit

@objc(PerformanceAudio)
class PerformanceAudio: RCTEventEmitter, AVAudioPlayerDelegate {
    private var recorder: StreamingTake?
    private var player: AVAudioPlayer?
    private var cue: AVAudioPlayer?
    private var preparedStrings: [String: AVAudioPlayer] = [:]
    private var preparedStringOrder: [String] = []
    private var preparedAlternates: [String: AVAudioPlayer] = [:]
    private var preparedSizes: [String: Int] = [:]
    private var guitarStrings: [Int: AVAudioPlayer] = [:]
    private var stringSessionActive = false
    private var metronomeEngine: AVAudioEngine?
    private var metronomeNode: AVAudioPlayerNode?
    private var beatEngine: AVAudioEngine?
    private var beatNodes: [AVAudioPlayerNode] = []
    private var beatBuffers: [AVAudioPCMBuffer] = []
    private var lastTake: URL?
    private var processing = Set<String>()
    private let worker = DispatchQueue(label: "guitar.prepare", qos: .userInitiated)
    private var observers: [NSObjectProtocol] = []
    private var observing = false
    private var instrumentInterrupted = false
    private var canPlayInstrument: Bool { !instrumentInterrupted && UIApplication.shared.applicationState == .active }
    private var directory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("performances", isDirectory: true)
    }
    override init() {
        super.init()
        try? reconcileRecordings()
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.finishTake()
            self?.stopPlayback()
            self?.emit("playbackInterrupted")
        })
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.handleForeground()
        })
        observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
            self?.handleInterruption(notification)
        })
    }
    private func handleForeground() {
        guard UIApplication.shared.applicationState == .active else { return }
        // An interruption need not deliver .ended. Permit the next explicit
        // Play to reactivate the session, without starting audio on foreground.
        instrumentInterrupted = false
    }
    private func handleInterruption(_ notification: Notification) {
        guard let value = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: value) else { return }
        if type == .began {
            // Suspension notifications can arrive after didBecomeActive.
            // They describe an inactive session, not an ongoing interruption.
            let suspended = notification.userInfo?[AVAudioSessionInterruptionWasSuspendedKey] as? Bool == true
            instrumentInterrupted = !(suspended && UIApplication.shared.applicationState == .active)
            finishTake()
            stopPlayback()
            emit("playbackInterrupted")
        } else if type == .ended {
            // The JS transport requires an explicit new Play; this only permits it.
            instrumentInterrupted = false
        }
    }
    deinit { recorder?.finish(interrupted: true) { _ in }; clearMetronomeBeats(); observers.forEach(NotificationCenter.default.removeObserver) }
    @objc override static func requiresMainQueueSetup() -> Bool { true }
    override var methodQueue: DispatchQueue! { DispatchQueue.main }
    override func supportedEvents() -> [String]! { ["onPerformanceAudio"] }
    override func startObserving() { observing = true }
    override func stopObserving() { observing = false }
    private func emit(_ state: String, uri: String? = nil) {
        if state == "playbackInterrupted" && !observing { return }
        sendEvent(withName: "onPerformanceAudio", body: ["state": state, "uri": uri ?? ""])
    }
    @objc func startTake(_ songId: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard songId.range(of: "^[1-9][0-9]*$", options: .regularExpression) != nil, recorder == nil, processing.isEmpty else {
            reject("RECORDING_BUSY", "Recording unavailable", nil); return
        }
        guard AVAudioSession.sharedInstance().recordPermission == .granted else {
            reject("RECORDING_FAILED", "Microphone permission denied", nil); return
        }
        stopPlayback()
        var ownedURL: URL?
        var capture: StreamingTake?
        do {
            let url = try reserveRecordingURL(songId)
            ownedURL = url
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
            guard session.isInputAvailable else { throw NSError(domain: "PerformanceAudio", code: 1) }
            let recording = try StreamingTake(url: url)
            capture = recording
            recording.onStop = { [weak self, weak recording] in
                guard let self = self, let recording = recording, self.recorder === recording else { return }
                self.finishTake()
            }
            recorder = recording
            try recording.start()
            lastTake = nil
            resolve(url.path)
        } catch {
            recorder = nil
            capture?.cancelStartup()
            if let url = ownedURL { try? removeRecordingFiles(url) }
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            reject("RECORDING_FAILED", "Could not start recording", error)
        }
    }
    @discardableResult private func finishTake() -> String? {
        guard let capture = recorder else { return lastTake?.path }
        recorder = nil
        let url = capture.url
        lastTake = capture.currentTime >= 0.2 ? url : nil
        processing.insert(url.path)
        emit("processing", uri: url.path)
        capture.finish(interrupted: instrumentInterrupted || UIApplication.shared.applicationState != .active) { [weak self] result in
            guard let self = self else { return }
            self.processing.remove(url.path)
            switch result {
            case .success(let interrupted):
                self.emit(interrupted ? "interrupted" : "saved", uri: url.path)
            case .failure:
                if self.lastTake == url { self.lastTake = nil }
                self.emit("error", uri: url.path)
            }
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        return lastTake?.path
    }
    @objc func stopTake(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) { resolve(finishTake()) }
    private func reserveRecordingURL(_ songId: String, timestamp: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) throws -> URL {
        let files = FileManager.default
        try files.createDirectory(at: directory, withIntermediateDirectories: true)
        var candidate = timestamp
        while true {
            let url = directory.appendingPathComponent("song-\(songId)-\(candidate).m4a")
            let base = url.deletingPathExtension()
            let blocked = processing.contains(url.path) || recorder?.url == url ||
                files.fileExists(atPath: base.appendingPathExtension("processing.m4a").path) ||
                files.fileExists(atPath: base.appendingPathExtension("interrupted").path)
            if !blocked {
                do {
                    try Data().write(to: url, options: .withoutOverwriting)
                    return url
                } catch let error as CocoaError where error.code == .fileWriteFileExists { }
            }
            guard candidate < Int64.max else { throw CocoaError(.fileWriteFileExists) }
            candidate += 1
        }
    }
    private func localFile(_ path: String) throws -> URL {
        let url = URL(fileURLWithPath: path).resolvingSymlinksInPath()
        guard url.deletingLastPathComponent() == directory.resolvingSymlinksInPath(), url.lastPathComponent.range(of: "^song-[0-9]+-[0-9]+\\.m4a$", options: .regularExpression) != nil else {
            throw NSError(domain: "PerformanceAudio", code: 2)
        }
        return url
    }
    private func reconcileRecordings() throws {
        let files = FileManager.default
        try files.createDirectory(at: directory, withIntermediateDirectories: true)
        var active = Set(processing.map { URL(fileURLWithPath: $0).resolvingSymlinksInPath().path })
        if let url = recorder?.url { active.insert(url.resolvingSymlinksInPath().path) }
        for partial in try files.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey]) {
            guard partial.lastPathComponent.range(of: "^song-[0-9]+-[0-9]+\\.processing\\.m4a$", options: .regularExpression) != nil else { continue }
            let name = partial.lastPathComponent.replacingOccurrences(of: ".processing.m4a", with: ".m4a")
            let target = directory.appendingPathComponent(name)
            guard !active.contains(target.resolvingSymlinksInPath().path) else { continue }
            if files.fileExists(atPath: target.path), (try target.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) > 0 {
                try files.removeItem(at: partial)
            } else if let audio = try? AVAudioFile(forReading: partial), audio.length > 0 {
                if files.fileExists(atPath: target.path) { try files.removeItem(at: target) }
                try files.moveItem(at: partial, to: target)
                let marker = target.deletingPathExtension().appendingPathExtension("interrupted")
                if !files.fileExists(atPath: marker.path) { try Data().write(to: marker, options: .withoutOverwriting) }
            } else { try files.removeItem(at: partial) }
        }
        for url in try files.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey]) {
            if url.lastPathComponent.range(of: "^song-[0-9]+-[0-9]+\\.m4a$", options: .regularExpression) != nil,
               !active.contains(url.resolvingSymlinksInPath().path),
               (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) == 0 {
                try files.removeItem(at: url)
            }
        }
        for marker in try files.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            guard marker.lastPathComponent.range(of: "^song-[0-9]+-[0-9]+\\.interrupted$", options: .regularExpression) != nil else { continue }
            let target = marker.deletingPathExtension().appendingPathExtension("m4a")
            let partial = marker.deletingPathExtension().appendingPathExtension("processing.m4a")
            if !active.contains(target.resolvingSymlinksInPath().path), !files.fileExists(atPath: target.path), !files.fileExists(atPath: partial.path) {
                try files.removeItem(at: marker)
            }
        }
    }
    private func removeRecordingFiles(_ url: URL) throws {
        let path = url.resolvingSymlinksInPath().path
        guard !processing.contains(where: { URL(fileURLWithPath: $0).resolvingSymlinksInPath().path == path }),
              recorder?.url.resolvingSymlinksInPath().path != path else {
            throw NSError(domain: "PerformanceAudio", code: 2)
        }
        let partial = url.deletingPathExtension().appendingPathExtension("processing.m4a")
        let marker = url.deletingPathExtension().appendingPathExtension("interrupted")
        for file in [partial, url, marker] where FileManager.default.fileExists(atPath: file.path) {
            try FileManager.default.removeItem(at: file)
        }
    }
    @objc func listTakes(_ songId: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        do {
            try reconcileRecordings()
            let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey])
            let rows: [[String: Any]] = try files.filter { $0.lastPathComponent.hasPrefix("song-\(songId)-") && $0.lastPathComponent.range(of: "^song-[0-9]+-[0-9]+\\.m4a$", options: .regularExpression) != nil && $0 != recorder?.url }.map { url in
                let values = try url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
                return ["path": url.path, "date": (values.contentModificationDate ?? .distantPast).timeIntervalSince1970 * 1000, "bytes": values.fileSize ?? 0, "processing": processing.contains(url.path), "interrupted": FileManager.default.fileExists(atPath: url.deletingPathExtension().appendingPathExtension("interrupted").path)]
            }
            resolve(rows.sorted { ($0["date"] as? Double ?? 0) > ($1["date"] as? Double ?? 0) })
        } catch { reject("FILES_FAILED", "Could not load recordings", error) }
    }
    @objc func playTake(_ path: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard recorder == nil, !processing.contains(path) else { reject("RECORDING_BUSY", "Recording in progress", nil); return }
        stopPlayback()
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
            let playback = try AVAudioPlayer(contentsOf: localFile(path))
            player = playback
            playback.delegate = self
            guard playback.prepareToPlay(), playback.play() else { throw NSError(domain: "PerformanceAudio", code: 3) }
            resolve(playback.duration * 1000)
        } catch { stopPlayback(); reject("PLAYBACK_FAILED", "Could not play recording", error) }
    }
    @objc func stopPlayback() {
        let wasPlaying = player != nil
        player?.stop(); player = nil
        cue?.stop(); cue = nil
        guitarStrings.values.forEach { $0.stop() }; guitarStrings.removeAll()
        stringSessionActive = false
        metronomeNode?.stop(); metronomeEngine?.stop()
        metronomeNode = nil; metronomeEngine = nil
        clearMetronomeBeats()
        if wasPlaying && recorder == nil { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
        if wasPlaying { emit("stopped") }
    }
    @objc func deleteTake(_ path: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard recorder == nil, !processing.contains(path) else { reject("RECORDING_BUSY", "Recording in progress", nil); return }
        do { stopPlayback(); try removeRecordingFiles(localFile(path)); resolve(true) }
        catch { reject("DELETE_FAILED", "Could not delete recording", error) }
    }
    @objc func playSuccess() {
        guard canPlayInstrument, recorder == nil, player == nil, let url = Bundle.main.url(forResource: "tuner_success", withExtension: "wav") else { return }
        cue?.stop()
        cue = try? AVAudioPlayer(contentsOf: url)
        cue?.volume = 0.3
        cue?.play()
    }
    @objc func setMetronome(_ tempo: Double, enabled: Bool, phase: Double) {
        metronomeNode?.stop(); metronomeEngine?.stop()
        metronomeNode = nil; metronomeEngine = nil
        guard enabled, canPlayInstrument, recorder == nil, tempo.isFinite, (40...200).contains(tempo) else { return }
        let rate = 22050.0
        let frames = AVAudioFrameCount((rate * 60 / tempo).rounded())
        let shift = phase.isFinite ? Int((Double(frames) * min(1, max(0, phase))).rounded()) % Int(frames) : 0
        guard let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
              let samples = buffer.floatChannelData?[0] else { return }
        buffer.frameLength = frames
        for index in 0..<Int(frames) {
            let time = Double((index + shift) % Int(frames)) / rate
            samples[index] = time < 0.025 ? Float(0.09 * sin(2 * .pi * 1200 * time) * (1 - exp(-2000 * time)) * exp(-200 * time)) : 0
        }
        let engine = AVAudioEngine()
        let node = AVAudioPlayerNode()
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)
            engine.prepare()
            try engine.start()
            node.scheduleBuffer(buffer, at: nil, options: .loops, completionHandler: nil)
            node.play()
            metronomeEngine = engine; metronomeNode = node
            stringSessionActive = true
        } catch { engine.stop() }
    }
    private func prepareMetronomeBeats() -> Bool {
        if beatEngine != nil { return true }
        let rate = 22050.0
        let frames = AVAudioFrameCount(rate * 0.03)
        guard let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1) else { return false }
        let engine = AVAudioEngine()
        var nodes: [AVAudioPlayerNode] = []
        var buffers: [AVAudioPCMBuffer] = []
        for accent in 0...2 {
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
                  let samples = buffer.floatChannelData?[0] else { return false }
            buffer.frameLength = frames
            let frequency = accent == 2 ? 1800.0 : accent == 1 ? 1350.0 : 900.0
            let level = accent == 2 ? 0.24 : accent == 1 ? 0.18 : 0.12
            for index in 0..<Int(frames) {
                let time = Double(index) / rate
                samples[index] = Float(level * sin(2 * .pi * frequency * time) *
                    (1 - exp(-3000 * time)) * exp(-180 * time) *
                    (1 - Double(index) / Double(frames - 1)))
            }
            let node = AVAudioPlayerNode()
            engine.attach(node)
            engine.connect(node, to: engine.mainMixerNode, format: format)
            nodes.append(node); buffers.append(buffer)
        }
        engine.prepare()
        beatEngine = engine; beatNodes = nodes; beatBuffers = buffers
        return true
    }
    // The tab transport owns timing. No looping buffer or independent beat timer.
    @objc func playMetronomeBeat(_ accent: Double, volume: Double) {
        guard canPlayInstrument, recorder == nil, accent.isFinite, volume.isFinite, volume > 0,
              prepareMetronomeBeats(), let engine = beatEngine else { return }
        let kind = Int(min(2, max(0, accent)).rounded())
        do {
            if !engine.isRunning {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
                try session.setActive(true)
                try engine.start()
                stringSessionActive = true
            }
            let node = beatNodes[kind]
            node.stop()
            node.volume = Float(min(1, max(0, volume)))
            node.scheduleBuffer(beatBuffers[kind], at: nil, options: [], completionHandler: nil)
            node.play()
        } catch { clearMetronomeBeats() }
    }
    @objc func stopMetronomeBeats() {
        beatNodes.forEach { $0.stop() }
        beatEngine?.pause()
    }
    private func clearMetronomeBeats() {
        stopMetronomeBeats()
        beatEngine?.stop(); beatEngine = nil
        beatNodes.removeAll(); beatBuffers.removeAll()
    }
    private func cacheGuitar(_ key: String, player: AVAudioPlayer, alternate: AVAudioPlayer? = nil, bytes: Int) {
        preparedStrings[key] = player
        preparedAlternates[key] = alternate
        preparedSizes[key] = bytes
        preparedStringOrder.removeAll { $0 == key }; preparedStringOrder.append(key)
        while preparedStringOrder.count > 32 || preparedSizes.values.reduce(0, +) > 32 * 1024 * 1024 {
            let oldest = preparedStringOrder.removeFirst()
            preparedStrings.removeValue(forKey: oldest)
            preparedAlternates.removeValue(forKey: oldest)
            preparedSizes.removeValue(forKey: oldest)
        }
    }
    @objc func prepareGuitar(_ key: String, wave: String) {
        guard key.count <= 256, wave.count <= 8000000 else { return }
        if let player = preparedStrings[key] {
            cacheGuitar(key, player: player, alternate: preparedAlternates[key], bytes: preparedSizes[key] ?? 0)
            return
        }
        guard let data = Data(base64Encoded: wave), let audio = try? AVAudioPlayer(data: data), audio.prepareToPlay() else { return }
        cacheGuitar(key, player: audio, bytes: data.count)
    }
    @objc func prepareFingering(_ key: String, wave: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard key.count <= 256, wave.count <= 8000000 else { resolve(false); return }
        if let player = preparedStrings[key], let alternate = preparedAlternates[key] {
            cacheGuitar(key, player: player, alternate: alternate, bytes: preparedSizes[key] ?? 0)
            resolve(true); return
        }
        guard !wave.isEmpty else { resolve(false); return }
        worker.async { [weak self] in
            guard let data = Data(base64Encoded: wave),
                  let first = try? AVAudioPlayer(data: data), let second = try? AVAudioPlayer(data: data),
                  first.prepareToPlay(), second.prepareToPlay() else {
                DispatchQueue.main.async { resolve(false) }; return
            }
            DispatchQueue.main.async {
                guard let self = self else { resolve(false); return }
                self.cacheGuitar(key, player: first, alternate: second, bytes: data.count * 2)
                resolve(self.preparedStrings[key] != nil)
            }
        }
    }
    @objc func playPreparedGuitar(_ key: String) {
        guard canPlayInstrument, recorder == nil, let audio = preparedStrings[key] else { return }
        let wasActive = stringSessionActive
        let previous = cue
        cue = nil
        if previous === audio { previous?.stop() }
        else {
            previous?.setVolume(0, fadeDuration: 0.016)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.02) { [weak self] in
                if self?.cue !== previous { previous?.stop() }
            }
        }
        stopPlayback()
        do {
            let session = AVAudioSession.sharedInstance()
            if !wasActive || session.category != .playback {
                try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
                try session.setActive(true)
            }
            stringSessionActive = true
            audio.currentTime = 0
            audio.setVolume(1, fadeDuration: 0)
            guard audio.play() else { return }
            cue = audio
            if let alternate = preparedAlternates[key] {
                preparedStrings[key] = alternate; preparedAlternates[key] = audio
            }
            preparedStringOrder.removeAll { $0 == key }; preparedStringOrder.append(key)
        } catch { cue = nil }
    }
    @objc func stopGuitarString(_ index: Int) {
        let voice = guitarStrings.removeValue(forKey: index)
        voice?.setVolume(0, fadeDuration: 0.016)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.02) { [weak self] in
            if self?.guitarStrings[index] !== voice { voice?.stop() }
        }
    }
    @objc func playGuitarString(_ key: String, index: Int) {
        guard canPlayInstrument, recorder == nil, (0..<6).contains(index), let audio = preparedStrings[key] else { return }
        if !stringSessionActive {
            let session = AVAudioSession.sharedInstance()
            do {
                try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
                try session.setActive(true)
                stringSessionActive = true
            } catch { return }
        }
        let previous = guitarStrings[index]
        if previous === audio {
            audio.stop()
        } else if let previous = previous {
            previous.setVolume(0, fadeDuration: 0.008)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) { [weak self] in
                if self?.guitarStrings[index] !== previous { previous.stop() }
            }
        }
        guitarStrings[index] = audio
        // Begin on the transport's attack, before even a very short note's gate
        // can release it. Only the old voice's fade cleanup is deferred.
        audio.currentTime = 0
        audio.setVolume(0.22, fadeDuration: 0)
        audio.play()
    }
    @objc func playGuitar(_ wave: String) {
        let key = "inline-preview"
        guard wave.count <= 8000000 else { return }
        preparedStrings.removeValue(forKey: key)
        preparedAlternates.removeValue(forKey: key)
        preparedSizes.removeValue(forKey: key)
        preparedStringOrder.removeAll { $0 == key }
        prepareGuitar(key, wave: wave)
        playPreparedGuitar(key)
    }
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        if player === self.player { stopPlayback() }
    }
    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        if player === self.player { stopPlayback(); emit("error") }
    }

}

private final class StreamingTake {
    let url: URL
    var onStop: (() -> Void)?
    private let engine: AVAudioEngine
    private let queue = DispatchQueue(label: "recording.stream", qos: .userInitiated)
    private let lock = NSLock()
    private let rate: Double
    private let output: URL
    private let marker: URL
    private var writer: AVAudioFile?
    private var effect: RecordingPolish
    private var frames: Int64 = 0
    private var written: Int64 = 0
    private var pending = 0
    private var pendingFrames: Int64 = 0
    private var lastBuffer = ProcessInfo.processInfo.systemUptime
    private var watchdog: DispatchSourceTimer?
    private var stopped = false
    private var finishing = false
    private var issue: Error?
    private var writeIssue: Error?
    private var tapInstalled = false

    var currentTime: Double {
        lock.lock(); defer { lock.unlock() }
        return Double(frames) / rate
    }

    init(url: URL) throws {
        let inputEngine = AVAudioEngine()
        engine = inputEngine
        self.url = url
        output = url.deletingPathExtension().appendingPathExtension("processing.m4a")
        marker = url.deletingPathExtension().appendingPathExtension("interrupted")
        let format = inputEngine.inputNode.outputFormat(forBus: 0)
        guard format.sampleRate.isFinite, (8000...192000).contains(format.sampleRate),
              (1...32).contains(format.channelCount), format.commonFormat == .pcmFormatFloat32,
              !format.isInterleaved else { throw NSError(domain: "RecordingFormat", code: 1) }
        rate = format.sampleRate
        effect = RecordingPolish(rate: format.sampleRate)
        try Data().write(to: marker, options: .withoutOverwriting)
        writer = try AVAudioFile(forWriting: output, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: rate,
            AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 160000
        ], commonFormat: .pcmFormatFloat32, interleaved: false)
    }

    func start() throws {
        let format = engine.inputNode.outputFormat(forBus: 0)
        engine.inputNode.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
            self?.append(buffer)
        }
        tapInstalled = true
        engine.prepare()
        try engine.start()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in
            guard let self = self else { return }
            self.lock.lock()
            let stalled = !self.stopped && self.issue == nil && ProcessInfo.processInfo.systemUptime - self.lastBuffer > 3
            if stalled { self.issue = NSError(domain: "RecordingInputUnavailable", code: 1) }
            self.lock.unlock()
            if stalled { self.onStop?() }
        }
        watchdog = timer
        timer.resume()
    }

    private func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        guard !stopped, issue == nil else { lock.unlock(); return }
        guard frames < Int64(rate * 1800) else {
            stopped = true; lock.unlock()
            DispatchQueue.main.async { [weak self] in self?.onStop?() }; return
        }
        guard pending < 8, pendingFrames + Int64(buffer.frameLength) <= Int64(rate),
              buffer.frameLength > 0, buffer.frameLength <= 65536,
              buffer.format.sampleRate == rate,
              let source = buffer.floatChannelData,
              let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength),
              let destination = copy.floatChannelData else {
            issue = NSError(domain: "RecordingBacklog", code: 1)
            lock.unlock()
            DispatchQueue.main.async { [weak self] in self?.onStop?() }; return
        }
        copy.frameLength = buffer.frameLength
        for channel in 0..<Int(buffer.format.channelCount) {
            destination[channel].update(from: source[channel], count: Int(buffer.frameLength))
        }
        pending += 1
        pendingFrames += Int64(buffer.frameLength)
        frames += Int64(buffer.frameLength)
        lastBuffer = ProcessInfo.processInfo.systemUptime
        queue.async { [self] in
            do {
                if writeIssue == nil { try render(copy) }
            } catch {
                writeIssue = error
                lock.lock(); issue = error; lock.unlock()
                DispatchQueue.main.async { [weak self] in self?.onStop?() }
            }
            lock.lock(); pending -= 1; pendingFrames -= Int64(copy.frameLength); lock.unlock()
        }
        lock.unlock()
    }

    private func render(_ input: AVAudioPCMBuffer) throws {
        guard let writer = writer, let samples = input.floatChannelData,
              let stereo = AVAudioPCMBuffer(pcmFormat: writer.processingFormat, frameCapacity: input.frameLength),
              let output = stereo.floatChannelData else { throw NSError(domain: "RecordingWrite", code: 1) }
        stereo.frameLength = input.frameLength
        let channels = Int(input.format.channelCount)
        for frame in 0..<Int(input.frameLength) {
            var sample = 0.0
            for channel in 0..<channels { sample += Double(samples[channel][frame]) }
            let value = effect.processStereo(sample / Double(channels))
            output[0][frame] = Float(value.0); output[1][frame] = Float(value.1)
        }
        try writer.write(from: stereo)
        written += Int64(input.frameLength)
    }

    private func stopInput() {
        watchdog?.cancel(); watchdog = nil
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        engine.stop()
    }

    func cancelStartup() {
        lock.lock(); stopped = true; lock.unlock()
        stopInput()
        queue.sync { writer = nil }
    }

    func finish(interrupted: Bool, completion: @escaping (Result<Bool, Error>) -> Void) {
        lock.lock()
        if finishing { lock.unlock(); return }
        finishing = true; stopped = true
        lock.unlock()
        stopInput()
        queue.async { [self] in
            lock.lock(); var partial = interrupted || issue != nil; lock.unlock()
            if !partial {
                do { try appendTail() } catch { partial = true; writeIssue = error }
            }
            writer = nil
            let result: Result<Bool, Error>
            do {
                guard written >= Int64(rate * 0.2),
                      let file = try? AVAudioFile(forReading: output), file.length > 0 else {
                    throw writeIssue ?? NSError(domain: "RecordingEmpty", code: 1)
                }
                _ = try FileManager.default.replaceItemAt(url, withItemAt: output)
                if !partial {
                    do { try FileManager.default.removeItem(at: marker) } catch { partial = true }
                }
                result = .success(partial)
            } catch {
                if written < Int64(rate * 0.2) {
                    try? FileManager.default.removeItem(at: output)
                    try? FileManager.default.removeItem(at: marker)
                }
                if (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) == 0 {
                    try? FileManager.default.removeItem(at: url)
                }
                result = .failure(error)
            }
            DispatchQueue.main.async { completion(result) }
        }
    }

    private func appendTail() throws {
        guard let writer = writer,
              let buffer = AVAudioPCMBuffer(pcmFormat: writer.processingFormat, frameCapacity: 4096),
              let samples = buffer.floatChannelData else { throw NSError(domain: "RecordingTail", code: 1) }
        var remaining = Int(rate)
        while remaining > 0 {
            buffer.frameLength = AVAudioFrameCount(min(remaining, 4096))
            for frame in 0..<Int(buffer.frameLength) {
                let value = effect.processStereo(0)
                let fade = min(1, Double(remaining - frame - 1) / (rate * 0.08))
                samples[0][frame] = Float(value.0 * fade); samples[1][frame] = Float(value.1 * fade)
            }
            try writer.write(from: buffer)
            remaining -= Int(buffer.frameLength)
        }
    }
}

private struct RecordingPolish {
    let equalizers: [[Double]]
    var eqState = [[Double]](repeating: [0, 0], count: 2)
    let roomDamping: Double
    let highPass: Double
    let envelopeRate: Double
    let attack: Double
    let release: Double
    var delays: [[Double]]
    var diffusion: [[Double]]
    var diffusionPositions = [Int](repeating: 0, count: 2)
    var positions = [Int](repeating: 0, count: 6)
    var damping = [Double](repeating: 0, count: 6)
    var previous = 0.0, filtered = 0.0, power = 0.0, gain = 1.0, limiter = 1.0
    init(rate: Double) {
        equalizers = [(380.0, -1.5), (3200.0, -1.0)].map { frequency, db in
            let a = pow(10.0, db / 40)
            let w = 2 * Double.pi * frequency / rate
            let alpha = sin(w) / 1.6
            let divisor = 1 + alpha / a
            return [(1 + alpha * a) / divisor, -2 * cos(w) / divisor,
                    (1 - alpha * a) / divisor, -2 * cos(w) / divisor, (1 - alpha / a) / divisor]
        }
        roomDamping = exp(-2 * .pi * 2400 / rate)
        highPass = exp(-2 * .pi * 75 / rate)
        envelopeRate = exp(-1 / (0.025 * rate))
        attack = exp(-1 / (0.015 * rate))
        release = exp(-1 / (0.25 * rate))
        diffusion = [0.005, 0.0017].map { [Double](repeating: 0, count: Int($0 * rate)) }
        delays = [0.0437, 0.0573, 0.0719, 0.0893, 0.1091, 0.1317].map { [Double](repeating: 0, count: Int($0 * rate)) }
    }
    mutating func process(_ input: Double) -> Double {
        let stereo = processStereo(input)
        return (stereo.0 + stereo.1) * 0.5
    }
    mutating func processStereo(_ input: Double) -> (Double, Double) {
        let sample = input.isFinite ? input : 0
        filtered = highPass * (filtered + sample - previous)
        previous = sample
        var tone = filtered
        for i in equalizers.indices {
            let c = equalizers[i]
            let output = c[0] * tone + eqState[i][0]
            eqState[i][0] = c[1] * tone - c[3] * output + eqState[i][1]
            eqState[i][1] = c[2] * tone - c[4] * output
            tone = output
        }
        power = envelopeRate * power + (1 - envelopeRate) * tone * tone
        let level = sqrt(power)
        let compression = level > 0.15 ? sqrt(0.15 / level) : 1
        let quiet = 0.85 + 0.15 * min(1, max(0, level / 0.002))
        let target = 1.05 * compression * quiet
        let smoothing = target < gain ? attack : release
        gain = smoothing * gain + (1 - smoothing) * target
        let dry = tone * gain
        var diffuse = dry
        for i in diffusion.indices {
            let delayed = diffusion[i][diffusionPositions[i]]
            let output = delayed - 0.55 * diffuse
            diffusion[i][diffusionPositions[i]] = diffuse + 0.55 * output
            diffusionPositions[i] += 1
            if diffusionPositions[i] == diffusion[i].count { diffusionPositions[i] = 0 }
            diffuse = output
        }
        var roomLeft = 0.0, roomRight = 0.0
        for i in delays.indices {
            let delayed = delays[i][positions[i]]
            damping[i] = roomDamping * damping[i] + (1 - roomDamping) * delayed
            delays[i][positions[i]] = diffuse + 0.48 * damping[i]
            positions[i] += 1
            if positions[i] == delays[i].count { positions[i] = 0 }
            if i % 2 == 0 { roomLeft += delayed } else { roomRight += delayed }
        }
        let roomGain = 0.65 / Double(delays.count / 2)
        let left = dry + roomGain * roomLeft, right = dry + roomGain * roomRight
        let ceiling = min(1, 0.88 / max(max(abs(left), abs(right)), 1e-12))
        limiter = ceiling < limiter ? ceiling : release * limiter + (1 - release) * ceiling
        return (min(0.88, max(-0.88, left * limiter)), min(0.88, max(-0.88, right * limiter)))
    }
}
