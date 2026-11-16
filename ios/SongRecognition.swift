import AVFoundation
import Foundation
import React
import UIKit

private final class RecognitionCapture {
  private let lock = NSLock()
  private var stopped = false
  private var samples = [Int16]()
  private var task: URLSessionDataTask?
  private var inputFrames: Int64 = 0
  private var outputFrames: Int64 = 0
  private var sampleSum: Float = 0
  private var sampleCount = 0

  var cancelled: Bool {
    lock.lock(); defer { lock.unlock() }
    return stopped
  }
  func cancel() {
    lock.lock()
    stopped = true
    let pending = task
    lock.unlock()
    pending?.cancel()
  }
  func attach(_ value: URLSessionDataTask) {
    lock.lock(); defer { lock.unlock() }
    task = value
    if stopped { value.cancel() }
  }
  func append(_ buffer: AVAudioPCMBuffer) {
    guard let channels = buffer.floatChannelData else { return }
    lock.lock(); defer { lock.unlock() }
    guard !stopped, samples.count < 320000 else { return }
    let rate = buffer.format.sampleRate
    for frame in 0..<Int(buffer.frameLength) {
      var value: Float = 0
      for channel in 0..<Int(buffer.format.channelCount) { value += channels[channel][frame] }
      value /= Float(buffer.format.channelCount)
      sampleSum += value
      sampleCount += 1
      inputFrames += 1
      let count = Int64(Double(inputFrames) * 16000 / rate)
      let previous = outputFrames
      while outputFrames < count, samples.count < 320000 {
        let average = sampleSum / Float(sampleCount)
        samples.append(Int16(max(-32767, min(32767, average.isFinite ? average * 32767 : 0))))
        outputFrames += 1
      }
      if previous < outputFrames { sampleSum = 0; sampleCount = 0 }
    }
  }
  func snapshot(_ count: Int) -> [Int16]? {
    lock.lock(); defer { lock.unlock() }
    return samples.count >= count ? Array(samples.suffix(min(samples.count, 192000))) : nil
  }
}

@objc(SongRecognition)
final class SongRecognition: NSObject, RCTBridgeModule {
  static func moduleName() -> String! { "SongRecognition" }
  @objc static func requiresMainQueueSetup() -> Bool { false }
  private let control = DispatchQueue(label: "song.recognition.control")
  private let worker = DispatchQueue(label: "song.recognition.worker", qos: .userInitiated)
  @objc var methodQueue: DispatchQueue! { control }
  private var active: RecognitionCapture?
  private var retryAfter = Date.distantPast
  private var observers = [NSObjectProtocol]()
  private var cached = [String: (Date, [String: Any])]()

  override init() {
    super.init()
    for name in [AVAudioSession.interruptionNotification, UIApplication.didEnterBackgroundNotification] {
      observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { [weak self] _ in
        self?.control.async { [weak self] in self?.active?.cancel() }
      })
    }
  }
  deinit {
    active?.cancel()
    observers.forEach(NotificationCenter.default.removeObserver)
  }

  @objc func cancel(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    active?.cancel()
    worker.async { self.control.async { resolve(nil) } }
  }

  @objc func recognizeMicrophone(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard active == nil else { reject("Busy", "RecognitionBusy", nil); return }
    guard AVAudioSession.sharedInstance().recordPermission == .granted else {
      reject("MicrophonePermissionDenied", "MicrophonePermissionDenied", nil); return
    }
    let capture = RecognitionCapture()
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
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetoothHFP])
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
        for seconds in [3, 7, 12, 20] {
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

  private func error(_ code: String) -> NSError { NSError(domain: code, code: 1) }
  private func check(_ capture: RecognitionCapture) throws {
    if capture.cancelled { throw error("Cancelled") }
  }
  private func identify(_ samples: [Int16], _ capture: RecognitionCapture) throws -> [String: Any]? {
    try check(capture)
    guard let pointer = samples.withUnsafeBufferPointer({ freetune_fingerprint($0.baseAddress, UInt($0.count)) }) else {
      throw error("AudioTooShort")
    }
    defer { freetune_fingerprint_free(pointer) }
    let signature = String(cString: pointer)
    if let (until, result) = cached[signature], until > Date() { return result }
    guard Date() >= retryAfter else { throw error("RateLimited") }
    let url = URL(string: "https://amp.shazam.com/discovery/v5/en-US/GB/iphone/-/tag/\(UUID().uuidString)/\(UUID().uuidString)?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3")!
    var request = URLRequest(url: url, timeoutInterval: 15)
    request.httpMethod = "POST"
    for (name, value) in ["Content-Type": "application/json", "X-Shazam-Platform": "IPHONE", "X-Shazam-AppVersion": "14.1.0", "Accept-Language": "en-US"] {
      request.setValue(value, forHTTPHeaderField: name)
    }
    request.httpBody = try JSONSerialization.data(withJSONObject: [
      "timezone": TimeZone.current.identifier, "timestamp": Int(Date().timeIntervalSince1970 * 1000),
      "signature": ["samplems": samples.count * 1000 / 16000, "uri": signature], "geolocation": [:], "context": [:]
    ])
    let response = RecognitionResponse()
    let task = URLSession.shared.dataTask(with: request) { data, value, failure in response.finish(data, value, failure) }
    capture.attach(task)
    task.resume()
    guard response.ready.wait(timeout: .now() + 16) == .success else {
      task.cancel(); throw error("NetworkError")
    }
    try check(capture)
    if response.failure != nil { throw error("NetworkError") }
    guard let http = response.response as? HTTPURLResponse else { throw error("NetworkError") }
    if http.statusCode == 429 {
      retryAfter = Date().addingTimeInterval(min(3600, max(1, Double(http.value(forHTTPHeaderField: "Retry-After") ?? "") ?? 30)))
      throw error("RateLimited")
    }
    guard (200..<300).contains(http.statusCode), let data = response.data else { throw error("ServiceUnavailable") }
    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let track = json["track"] as? [String: Any],
      let title = track["title"] as? String, !title.isEmpty,
      let artist = track["subtitle"] as? String, !artist.isEmpty else { return nil }
    var result: [String: Any] = ["title": title, "artist": artist, "source": "Shazam"]
    result["cover"] = (track["images"] as? [String: Any])?["coverart"]
    result["url"] = track["url"]
    result["genre"] = (track["genres"] as? [String: Any])?["primary"]
    for section in track["sections"] as? [[String: Any]] ?? [] {
      for entry in section["metadata"] as? [[String: Any]] ?? [] {
        let label = (entry["title"] as? String ?? "").lowercased()
        if label == "album" { result["album"] = entry["text"] }
        if ["bpm", "tempo"].contains(label), let text = entry["text"] as? String,
          let tempo = Double(text), (30...300).contains(tempo) { result["tempo"] = tempo }
      }
    }
    if cached.count >= 20 { cached.removeAll() }
    cached[signature] = (Date().addingTimeInterval(600), result)
    return result
  }
}

private final class RecognitionResponse {
  let ready = DispatchSemaphore(value: 0)
  var data: Data?
  var response: URLResponse?
  var failure: Error?
  func finish(_ data: Data?, _ response: URLResponse?, _ failure: Error?) {
    self.data = data; self.response = response; self.failure = failure
    ready.signal()
  }
}
