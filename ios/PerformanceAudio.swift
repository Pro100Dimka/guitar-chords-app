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
            emit("saved", uri: capture.url.path)
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
            let rows: [[String: Any]] = try files.filter { $0.lastPathComponent.hasPrefix("song-\(songId)-") && $0.pathExtension == "m4a" && $0 != recorder?.url }.map { url in
                let values = try url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
                return ["path": url.path, "date": (values.contentModificationDate ?? .distantPast).timeIntervalSince1970 * 1000, "bytes": values.fileSize ?? 0]
            }
            resolve(rows.sorted { ($0["date"] as? Double ?? 0) > ($1["date"] as? Double ?? 0) })
        } catch { reject("FILES_FAILED", "Could not load recordings", error) }
    }
    @objc func playTake(_ path: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard recorder == nil else { reject("RECORDING_BUSY", "Recording in progress", nil); return }
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
        guard recorder == nil else { reject("RECORDING_BUSY", "Recording in progress", nil); return }
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
