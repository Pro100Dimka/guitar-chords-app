import AVFoundation
import Foundation
import React
import UIKit

@objc(PerformanceAudio)
class PerformanceAudio: RCTEventEmitter, AVAudioRecorderDelegate, AVAudioPlayerDelegate {
    private var recorder: AVAudioRecorder?
    private var player: AVAudioPlayer?
    private var cue: AVAudioPlayer?
    private var lastTake: URL?
    private var startedAt: Date?
    private var processing = Set<String>()
    private let worker = DispatchQueue(label: "recording.polish", qos: .userInitiated)
    private var observers: [NSObjectProtocol] = []
    private var directory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("performances", isDirectory: true)
    }
    override init() {
        super.init()
        for name in [UIApplication.didEnterBackgroundNotification, AVAudioSession.interruptionNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.finishTake()
                self?.stopPlayback()
            })
        }
    }
    deinit { observers.forEach(NotificationCenter.default.removeObserver) }
    @objc override static func requiresMainQueueSetup() -> Bool { true }
    override var methodQueue: DispatchQueue! { DispatchQueue.main }
    override func supportedEvents() -> [String]! { ["onPerformanceAudio"] }
    private func emit(_ state: String, uri: String? = nil) {
        sendEvent(withName: "onPerformanceAudio", body: ["state": state, "uri": uri ?? ""])
    }
    @objc func startTake(_ songId: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard songId.range(of: "^[1-9][0-9]*$", options: .regularExpression) != nil, recorder == nil else {
            reject("RECORDING_BUSY", "Recording unavailable", nil); return
        }
        stopPlayback()
        let url = directory.appendingPathComponent("song-\(songId)-\(Int(Date().timeIntervalSince1970 * 1000)).m4a")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
            let capture = try AVAudioRecorder(url: url, settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 44100,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 128000,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ])
            capture.delegate = self
            guard capture.prepareToRecord(), capture.record(forDuration: 1800) else {
                throw NSError(domain: "PerformanceAudio", code: 1)
            }
            startedAt = Date()
            recorder = capture
            lastTake = nil
            resolve(url.path)
        } catch {
            try? FileManager.default.removeItem(at: url)
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            reject("RECORDING_FAILED", "Could not start recording", error)
        }
    }
    @discardableResult private func finishTake() -> String? {
        guard let capture = recorder else { return lastTake?.path }
        let duration = max(capture.currentTime, startedAt.map { Date().timeIntervalSince($0) } ?? 0)
        startedAt = nil
        recorder = nil
        capture.stop()
        if duration >= 0.2 {
            lastTake = capture.url
            polish(capture.url)
        } else {
            try? FileManager.default.removeItem(at: capture.url)
            lastTake = nil
            emit("error")
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        return lastTake?.path
    }
    @objc func stopTake(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) { resolve(finishTake()) }
    private func localFile(_ path: String) throws -> URL {
        let url = URL(fileURLWithPath: path).resolvingSymlinksInPath()
        guard url.deletingLastPathComponent() == directory.resolvingSymlinksInPath(), url.lastPathComponent.range(of: "^song-[0-9]+-[0-9]+\\.m4a$", options: .regularExpression) != nil else {
            throw NSError(domain: "PerformanceAudio", code: 2)
        }
        return url
    }
    @objc func listTakes(_ songId: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey])
            let rows: [[String: Any]] = try files.filter { $0.lastPathComponent.hasPrefix("song-\(songId)-") && $0.lastPathComponent.range(of: "^song-[0-9]+-[0-9]+\\.m4a$", options: .regularExpression) != nil && $0 != recorder?.url }.map { url in
                let values = try url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
                return ["path": url.path, "date": (values.contentModificationDate ?? .distantPast).timeIntervalSince1970 * 1000, "bytes": values.fileSize ?? 0, "processing": processing.contains(url.path)]
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
        if wasPlaying && recorder == nil { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
        if wasPlaying { emit("stopped") }
    }
    @objc func deleteTake(_ path: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard recorder == nil, !processing.contains(path) else { reject("RECORDING_BUSY", "Recording in progress", nil); return }
        do { stopPlayback(); try FileManager.default.removeItem(at: localFile(path)); resolve(true) }
        catch { reject("DELETE_FAILED", "Could not delete recording", error) }
    }
    @objc func playSuccess() {
        guard recorder == nil, player == nil, let url = Bundle.main.url(forResource: "tuner_success", withExtension: "wav") else { return }
        cue?.stop()
        cue = try? AVAudioPlayer(contentsOf: url)
        cue?.volume = 0.3
        cue?.play()
    }
    @objc func playGuitar(_ wave: String) {
        guard recorder == nil, wave.count <= 400000, let data = Data(base64Encoded: wave) else { return }
        let previous = cue
        cue = nil
        previous?.setVolume(0, fadeDuration: 0.016)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.02) { previous?.stop() }
        stopPlayback()
        do {
            let session = AVAudioSession.sharedInstance()
            if session.category != .playAndRecord {
                try session.setCategory(.ambient, mode: .default)
            }
            try session.setActive(true)
            cue = try AVAudioPlayer(data: data)
            cue?.prepareToPlay()
            cue?.play()
        } catch { cue = nil }
    }
    private func polish(_ url: URL) {
        processing.insert(url.path)
        emit("processing", uri: url.path)
        worker.async { [self] in
            let output = url.deletingPathExtension().appendingPathExtension("processing.m4a")
            var state = "saved"
            do {
                let date = try url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
                try autoreleasepool { try Self.renderPolished(url, output: output) }
                _ = try FileManager.default.replaceItemAt(url, withItemAt: output)
                if let date = date { try? FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: url.path) }
            } catch { state = "processingFailed" }
            try? FileManager.default.removeItem(at: output)
            let completedState = state
            DispatchQueue.main.async { [self] in
                processing.remove(url.path)
                emit(completedState, uri: url.path)
            }
        }
    }
    private static func renderPolished(_ input: URL, output: URL) throws {
        let reader = try AVAudioFile(forReading: input, commonFormat: .pcmFormatFloat32, interleaved: false)
        let format = reader.processingFormat
        guard format.channelCount == 1, reader.length > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096) else {
            throw NSError(domain: "PerformanceAudio", code: 4)
        }
        let writer = try AVAudioFile(forWriting: output, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: format.sampleRate,
            AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 160000
        ], commonFormat: .pcmFormatFloat32, interleaved: false)
        var effect = RecordingPolish(rate: format.sampleRate)
        while reader.framePosition < reader.length {
            try reader.read(into: buffer)
            guard buffer.frameLength > 0, let samples = buffer.floatChannelData?[0] else {
                throw NSError(domain: "PerformanceAudio", code: 5)
            }
            for index in 0..<Int(buffer.frameLength) { samples[index] = Float(effect.process(Double(samples[index]))) }
            try writer.write(from: buffer)
        }
        var tail = Int(format.sampleRate)
        while tail > 0 {
            buffer.frameLength = AVAudioFrameCount(min(tail, Int(buffer.frameCapacity)))
            guard let samples = buffer.floatChannelData?[0] else { break }
            for index in 0..<Int(buffer.frameLength) { samples[index] = Float(effect.process(0) * min(1, Double(tail - index - 1) / (format.sampleRate * 0.08))) }
            try writer.write(from: buffer)
            tail -= Int(buffer.frameLength)
        }
    }
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        if player === self.player { stopPlayback() }
    }
    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        if player === self.player { stopPlayback(); emit("error") }
    }
    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        if recorder === self.recorder { finishTake() }
    }
    func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        if recorder === self.recorder { finishTake(); emit("error") }
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
        var room = 0.0
        for i in delays.indices {
            let delayed = delays[i][positions[i]]
            damping[i] = roomDamping * damping[i] + (1 - roomDamping) * delayed
            delays[i][positions[i]] = diffuse + 0.48 * damping[i]
            positions[i] += 1
            if positions[i] == delays[i].count { positions[i] = 0 }
            room += delayed
        }
        let mixed = dry + 0.65 * room / Double(delays.count)
        let ceiling = min(1, 0.88 / max(abs(mixed), 1e-12))
        limiter = ceiling < limiter ? ceiling : release * limiter + (1 - release) * ceiling
        return min(0.88, max(-0.88, mixed * limiter))
    }
}
