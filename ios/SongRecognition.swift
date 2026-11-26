import AVFoundation
import Foundation
import React
import UIKit
import UserNotifications

@objc(SongRecognition)
final class SongRecognition: NSObject, RCTBridgeModule {
  static weak var controlInstance: SongRecognition?
  static func moduleName() -> String! { "SongRecognition" }
  @objc static func requiresMainQueueSetup() -> Bool { false }
  private let control = DispatchQueue(label: "song.recognition.control")
  private let worker = DispatchQueue(label: "song.recognition.worker", qos: .userInitiated)
  @objc var methodQueue: DispatchQueue! { control }
  private var active: RecognitionCapture?
  private var observers = [NSObjectProtocol]()
  private let fingerprint = SongFingerprintRecognizer()

  override init() {
    super.init()
    Self.controlInstance = self
    for name in [AVAudioSession.interruptionNotification, UIApplication.didEnterBackgroundNotification] {
      observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { [weak self] notification in
        self?.control.async { [weak self] in
          guard let capture = self?.active else { return }
          if name == AVAudioSession.interruptionNotification {
            if !capture.ignoresAudioInterruptions,
               let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
               type == AVAudioSession.InterruptionType.began.rawValue { capture.cancel() }
          } else if !capture.allowsBackground { capture.cancel() }
        }
      })
    }
    observers.append(NotificationCenter.default.addObserver(forName: RecognitionNotice.received, object: nil, queue: nil) { [weak self] notification in
      guard let payload = notification.userInfo else { return }
      self?.control.async { [weak self] in
        guard let capture = self?.active, capture.ignoresAudioInterruptions else { return }
        capture.receivePlayback(payload)
      }
    })
    #if os(iOS)
    observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { [weak self] _ in
      self?.control.async { [weak self] in
        guard let capture = self?.active, capture.ignoresAudioInterruptions else { return }
        UNUserNotificationCenter.current().getDeliveredNotifications { notifications in
          if let latest = notifications.filter({ $0.request.content.userInfo["recognitionPlayback"] as? Bool == true }).max(by: { $0.date < $1.date }) {
            capture.receivePlayback(latest.request.content.userInfo)
          }
        }
      }
    })
    #endif
  }
  deinit {
    active?.cancel()
    observers.forEach(NotificationCenter.default.removeObserver)
  }

  @objc func cancel(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    if active?.ignoresAudioInterruptions == true { RecognitionNotice.cancelCapture() }
    active?.cancel()
    worker.async { self.control.async { resolve(nil) } }
  }

  @objc func recognizeMicrophone(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    startMicrophone(resolve, rejecter: reject, allowsBackground: false)
  }

  func recognizeFromControl() async throws -> [String: Any]? {
    try await withCheckedThrowingContinuation { continuation in
      control.async {
        self.startMicrophone({ value in continuation.resume(returning: value as? [String: Any]) }, rejecter: { code, message, error in
          continuation.resume(throwing: error ?? NSError(domain: code ?? "RecognitionFailed", code: 1, userInfo: [NSLocalizedDescriptionKey: message ?? "Recognition failed"]))
        }, allowsBackground: true)
      }
    }
  }

  private func startMicrophone(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock, allowsBackground: Bool) {
    guard active == nil else { reject("Busy", "RecognitionBusy", nil); return }
    guard AVAudioSession.sharedInstance().recordPermission == .granted else {
      reject("MicrophonePermissionDenied", "MicrophonePermissionDenied", nil); return
    }
    let capture = RecognitionCapture(allowsBackground: allowsBackground)
    active = capture
    worker.async {
      var engine: AVAudioEngine?
      var sessionActivated = false
      var tapInstalled = false
      var result: [String: Any]?
      var failure: Error?
      do {
        try self.check(capture)
        let session = AVAudioSession.sharedInstance()
        // Keep the player's audio running and its stereo Bluetooth route available.
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .mixWithOthers, .allowBluetoothA2DP])
        try session.setActive(true)
        sessionActivated = true
        let input = AVAudioEngine()
        engine = input
        let format = input.inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw self.error("AudioDeviceUnavailable") }
        input.inputNode.installTap(onBus: 0, bufferSize: 2048, format: format) { buffer, _ in capture.append(buffer) }
        tapInstalled = true
        input.prepare()
        try self.check(capture)
        try input.start()
        let deadline = Date().addingTimeInterval(23)
        for seconds in allowsBackground ? [7] : [3, 7, 12, 20] {
          var samples: [Int16]?
          while samples == nil {
            try self.check(capture)
            guard Date() < deadline else { throw self.error("MicrophoneReadFailed") }
            samples = capture.snapshot(seconds * 16000)
            if samples == nil { Thread.sleep(forTimeInterval: 0.04) }
          }
          if let found = try self.identify(samples!, capture) { result = found; break }
        }
      } catch { failure = error }
      if tapInstalled { engine?.inputNode.removeTap(onBus: 0) }
      engine?.stop()
      if sessionActivated { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
      self.control.async {
        if self.active === capture { self.active = nil }
        if capture.cancelled { reject("Cancelled", "Cancelled", nil) }
        else if let failure = failure {
          let code = (failure as NSError).domain
          reject(code, code, failure)
        } else { resolve(result) }
      }
    }
  }

  #if os(iOS)
  @objc func getRecognitionSource(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(AVAudioSession.sharedInstance().isOtherAudioPlaying ? "playback" : "mic")
  }

  @objc func consumeLaunchURL(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async { resolve(RecognitionLaunch.consume()) }
  }

  @objc func consumeResult(_ requestId: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(RecognitionLaunch.consumeSong(requestId))
  }

  @objc func recognizePlayback(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard active == nil else { reject("Busy", "RecognitionBusy", nil); return }
    guard PlaybackCaptureViewController.broadcastExtension != nil else {
      reject("PlaybackCaptureUnavailable", "PlaybackCaptureUnavailable", nil); return
    }
    let capture = RecognitionCapture(allowsBackground: true, ignoresAudioInterruptions: true)
    active = capture
    let expires = Date().addingTimeInterval(180)
    let failureId = UUID().uuidString
    let fail: (String) -> Void = { code in
      capture.receivePlayback(["recognitionPlayback": true, "recognitionStartedAt": capture.createdAt.timeIntervalSince1970, "recognitionRequestId": failureId, "recognitionError": code])
    }
    let sheet = DispatchQueue.main.sync { PlaybackCaptureViewController() }
    DispatchQueue.main.async {
      sheet.onCancel = { RecognitionNotice.cancelCapture(); capture.cancel() }
      func presentCapture(_ attempt: Int = 0) {
        guard !capture.cancelled else { return }
        guard attempt < 50 else { fail("PlaybackCaptureFailed"); return }
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
        var presenter = scene?.windows.first { $0.isKeyWindow }?.rootViewController
        while let next = presenter?.presentedViewController { presenter = next }
        guard let presenter = presenter, !presenter.isBeingDismissed, !presenter.isBeingPresented, presenter.transitionCoordinator == nil else {
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { presentCapture(attempt + 1) }; return
        }
        presenter.present(sheet, animated: true)
      }
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
        DispatchQueue.main.async {
          if granted { presentCapture() } else { fail("PlaybackNotificationsDenied") }
        }
      }
    }
    worker.async {
      var result: [String: Any]?
      var failure: Error?
      do {
        var payload = capture.playbackResult
        while payload == nil {
          try self.check(capture)
          guard Date() < expires else { throw self.error("PlaybackCaptureTimeout") }
          Thread.sleep(forTimeInterval: 0.1)
          payload = capture.playbackResult
        }
        try self.check(capture)
        if let code = payload?["recognitionError"] as? String, !code.isEmpty { throw self.error(code) }
        result = RecognitionNotice.song(payload ?? [:])
        if let result = result, let id = payload?["recognitionRequestId"] as? String { RecognitionLaunch.saveSong(result, requestId: id) }
      } catch { failure = error }
      RecognitionNotice.cancelCapture()
      DispatchQueue.main.async { sheet.finish() }
      self.control.async {
        if self.active === capture { self.active = nil }
        if capture.cancelled { reject("Cancelled", "Cancelled", nil) }
        else if let failure = failure {
          let code = (failure as NSError).domain
          let known = ["PlaybackCaptureUnavailable", "PlaybackCaptureTimeout", "PlaybackAudioUnavailable", "PlaybackCaptureFailed", "PlaybackNotificationsDenied", "Cancelled", "NetworkError", "RateLimited", "ServiceUnavailable", "AudioTooShort"]
          let message = known.contains(code) ? code : "PlaybackCaptureFailed"
          reject(message, message, failure)
        } else { resolve(result) }
      }
    }
  }
  #endif

  @objc func recognizeFile(_ uri: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard active == nil else { reject("Busy", "RecognitionBusy", nil); return }
    guard let url = URL(string: uri), url.isFileURL else { reject("FileUnavailable", "FileUnavailable", nil); return }
    let capture = RecognitionCapture()
    active = capture
    worker.async {
      let scoped = url.startAccessingSecurityScopedResource()
      defer { if scoped { url.stopAccessingSecurityScopedResource() } }
      var result: [String: Any]?
      var failure: Error?
      do {
        try self.check(capture)
        let coordinator = NSFileCoordinator(filePresenter: nil)
        capture.attach(coordinator)
        let timeout = DispatchWorkItem { capture.expireReading() }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 30, execute: timeout)
        var coordinationError: NSError?
        var samples: [Int16]?
        var duration: Double?
        coordinator.coordinate(readingItemAt: url, options: .withoutChanges, error: &coordinationError) { localURL in
          do {
            try self.check(capture)
            let audio = try AVAudioFile(forReading: localURL, commonFormat: .pcmFormatFloat32, interleaved: false)
            let format = audio.processingFormat
            guard format.sampleRate.isFinite, (8000...384000).contains(format.sampleRate), (1...32).contains(format.channelCount), audio.length > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096) else { throw self.error("UnsupportedAudio") }
            let seconds = Double(audio.length) / format.sampleRate
            duration = seconds
            if seconds > 15 { audio.framePosition = max(0, audio.length / 2 - AVAudioFramePosition(format.sampleRate * 6)) }
            var remaining = AVAudioFramePosition(format.sampleRate * 12)
            while remaining > 0 && audio.framePosition < audio.length {
              try self.check(capture)
              try audio.read(into: buffer, frameCount: AVAudioFrameCount(min(4096, remaining)))
              guard buffer.frameLength > 0 else { break }
              capture.append(buffer)
              remaining -= AVAudioFramePosition(buffer.frameLength)
            }
            try self.check(capture)
            guard let decoded = capture.snapshot(16000) else { throw self.error("AudioTooShort") }
            samples = decoded
          } catch { failure = error }
        }
        timeout.cancel()
        capture.finishReading()
        try self.check(capture)
        if let failure = failure { throw failure }
        guard coordinationError == nil, let samples = samples else { throw self.error("FileUnavailable") }
        result = try self.identify(samples, capture)
        if let duration = duration, duration.isFinite, duration > 0, duration <= 86400 { result?["duration"] = duration }
      } catch { failure = error }
      capture.finishReading()
      self.control.async {
        if self.active === capture { self.active = nil }
        if capture.cancelled { reject("Cancelled", "Cancelled", nil) }
        else if let failure = failure {
          let code = (failure as NSError).domain
          let known = ["AudioTooShort", "UnsupportedAudio", "FileReadTimeout", "NetworkError", "RateLimited", "ServiceUnavailable", "FileUnavailable"]
          let message = known.contains(code) ? code : "AudioDecodeFailed"
          reject(message, message, failure)
        } else { resolve(result) }
      }
    }
  }

  private func error(_ code: String) -> NSError { NSError(domain: code, code: 1) }
  private func check(_ capture: RecognitionCapture) throws {
    if capture.cancelled { throw error("Cancelled") }
    if capture.fileReadExpired { throw error("FileReadTimeout") }
  }
  private func identify(_ samples: [Int16], _ capture: RecognitionCapture) throws -> [String: Any]? {
    try fingerprint.identify(samples, cancelled: { capture.cancelled }, attach: { capture.attach($0) })
  }
}
