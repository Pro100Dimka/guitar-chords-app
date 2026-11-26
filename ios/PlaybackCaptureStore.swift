import AVFoundation
import CoreFoundation
import Foundation
import UserNotifications

final class RecognitionCapture {
  let allowsBackground: Bool
  let ignoresAudioInterruptions: Bool
  let createdAt = Date()
  private let lock = NSLock()
  private var receivedPlayback: [AnyHashable: Any]?
  private var stopped = false
  private var samples = [Int16]()
  private var task: URLSessionDataTask?
  private var recordingCancellation: (() -> Void)?
  private var fileCoordinator: NSFileCoordinator?
  private var readExpired = false

  init(allowsBackground: Bool = false, ignoresAudioInterruptions: Bool = false) {
    self.allowsBackground = allowsBackground
    self.ignoresAudioInterruptions = ignoresAudioInterruptions
  }

  func receivePlayback(_ payload: [AnyHashable: Any]) {
    guard payload["recognitionPlayback"] as? Bool == true,
          let started = payload["recognitionStartedAt"] as? Double,
          started >= createdAt.timeIntervalSince1970 else { return }
    lock.lock(); defer { lock.unlock() }
    if !stopped { receivedPlayback = payload }
  }
  var playbackResult: [AnyHashable: Any]? {
    lock.lock(); defer { lock.unlock() }
    return receivedPlayback
  }
  var fileReadExpired: Bool {
    lock.lock(); defer { lock.unlock() }
    return readExpired
  }
  func attach(_ coordinator: NSFileCoordinator) {
    lock.lock()
    fileCoordinator = coordinator
    let cancel = stopped
    lock.unlock()
    if cancel { coordinator.cancel() }
  }
  func finishReading() {
    lock.lock(); defer { lock.unlock() }
    fileCoordinator = nil
  }
  func expireReading() {
    lock.lock()
    let coordinator = fileCoordinator
    if coordinator != nil { readExpired = true }
    lock.unlock()
    coordinator?.cancel()
  }
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
    let coordinator = fileCoordinator
    let recording = recordingCancellation
    lock.unlock()
    pending?.cancel()
    coordinator?.cancel()
    recording?()
  }
  func attach(_ cancellation: @escaping () -> Void) {
    lock.lock()
    recordingCancellation = cancellation
    let cancel = stopped
    lock.unlock()
    if cancel { cancellation() }
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

enum RecognitionNotice {
  static let received = Notification.Name("FreeTunePlaybackRecognitionResult")
  static let cancellationName = "com.freetune.recognition.cancel" as CFString
  static func cancelCapture() {
    CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(rawValue: cancellationName), nil, nil, true)
  }
  static func deliver(_ payload: [AnyHashable: Any]) {
    NotificationCenter.default.post(name: received, object: nil, userInfo: payload)
  }
  static func text(_ en: String, _ ru: String, _ uk: String) -> String {
    let language = Locale.preferredLanguages.first?.prefix(2).lowercased()
    return ["ru": ru, "uk": uk][language ?? ""] ?? en
  }
  static func song(_ payload: [AnyHashable: Any]) -> [String: Any]? {
    guard let data = payload["recognitionSong"] as? Data else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }
  static func content(_ song: [String: Any]?, requestId: String, error: String? = nil, startedAt: Date = Date(), playback: Bool = false) -> UNMutableNotificationContent {
    let content = UNMutableNotificationContent()
    content.title = "FreeTune"
    content.userInfo = ["recognitionRequestId": requestId, "recognitionStartedAt": startedAt.timeIntervalSince1970, "recognitionPlayback": playback, "recognitionError": error ?? ""]
    if let song = song, let title = song["title"] as? String, let artist = song["artist"] as? String {
      content.body = "\(artist): \(title)"
      let metadata = song.filter { !["lyrics", "lyricsCredit"].contains($0.key) }
      if let data = try? JSONSerialization.data(withJSONObject: metadata) { content.userInfo["recognitionSong"] = data }
    } else {
      content.body = error == nil
        ? text("Song not found", "Песня не найдена", "Пісню не знайдено")
        : text("Recognition failed. Check the connection and audio access.", "Не удалось распознать. Проверьте подключение и доступ к звуку.", "Не вдалося розпізнати. Перевірте з’єднання та доступ до звуку.")
    }
    return content
  }
  static func show(_ song: [String: Any]?, requestId: String, error: String? = nil, startedAt: Date = Date(), playback: Bool = false, completion: (() -> Void)? = nil) {
    let content = Self.content(song, requestId: requestId, error: error, startedAt: startedAt, playback: playback)
    UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "recognition-\(requestId)", content: content, trigger: nil)) { _ in completion?() }
  }
}

final class SongFingerprintRecognizer {
  private var retryAfter = Date.distantPast
  private var cached = [String: (Date, [String: Any])]()
  private func error(_ code: String) -> NSError { NSError(domain: code, code: 1) }
  func identify(_ samples: [Int16], cancelled: () -> Bool = { false }, attach: (URLSessionDataTask) -> Void = { _ in }) throws -> [String: Any]? {
    if cancelled() { throw error("Cancelled") }
    guard let pointer = samples.withUnsafeBufferPointer({ freetune_fingerprint($0.baseAddress, UInt($0.count)) }) else {
      throw error("AudioTooShort")
    }
    defer { freetune_fingerprint_free(pointer) }
    let signature = String(cString: pointer)
    return try identify(signature: signature, sampleMilliseconds: samples.count * 1000 / 16000, cancelled: cancelled, attach: attach)
  }
  func identify(signature encodedSignature: String, sampleMilliseconds: Int, cancelled: () -> Bool = { false }, attach: (URLSessionDataTask) -> Void = { _ in }) throws -> [String: Any]? {
    if cancelled() { throw error("Cancelled") }
    let prefix = "data:audio/vnd.shazam.sig;base64,"
    guard encodedSignature.hasPrefix(prefix),
          let data = Data(base64Encoded: String(encodedSignature.dropFirst(prefix.count))),
          let header = data.range(of: Data([0x80, 0x25, 0xfe, 0xca])) else { throw error("RecognitionFailed") }
    // ShazamKit data includes a container; the service expects the embedded wire signature.
    let signature = prefix + data[header.lowerBound...].base64EncodedString()
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
      "signature": ["samplems": sampleMilliseconds, "uri": signature], "geolocation": [:], "context": [:]
    ])
    let response = FingerprintResponse()
    let task = URLSession.shared.dataTask(with: request) { data, value, failure in response.finish(data, value, failure) }
    attach(task)
    task.resume()
    guard response.ready.wait(timeout: .now() + 16) == .success else {
      task.cancel(); throw error("NetworkError")
    }
    if cancelled() { throw error("Cancelled") }
    if response.failure != nil { throw error("NetworkError") }
    guard let http = response.response as? HTTPURLResponse else { throw error("NetworkError") }
    if http.statusCode == 429 {
      retryAfter = Date().addingTimeInterval(min(3600, max(1, Double(http.value(forHTTPHeaderField: "Retry-After") ?? "") ?? 30)))
      throw error("RateLimited")
    }
    guard (200..<300).contains(http.statusCode), let data = response.data else { throw NSError(domain: "ServiceUnavailable", code: http.statusCode) }
    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let track = json["track"] as? [String: Any],
      let title = track["title"] as? String, !title.isEmpty,
      let artist = track["subtitle"] as? String, !artist.isEmpty else { return nil }
    var result: [String: Any] = ["title": title, "artist": artist, "source": "Shazam"]
    result["cover"] = (track["images"] as? [String: Any])?["coverart"]
    result["url"] = track["url"]
    result["genre"] = (track["genres"] as? [String: Any])?["primary"]
    for key in ["bpm", "tempo"] {
      if let tempo = track[key] as? Double, tempo.isFinite, (40...200).contains(tempo) { result["tempo"] = tempo; break }
    }
    if let duration = track["duration"] as? Double, duration.isFinite, duration > 0, duration <= 86400 { result["duration"] = duration }
    for section in track["sections"] as? [[String: Any]] ?? [] {
      if section["type"] as? String == "LYRICS", let lines = section["text"] as? [String] {
        let lyrics = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        if !lyrics.isEmpty && lyrics.count <= 200000 {
          result["lyrics"] = lyrics
          result["lyricsCredit"] = String((section["footer"] as? String ?? "").prefix(2000))
        }
      }
      for entry in section["metadata"] as? [[String: Any]] ?? [] {
        let label = (entry["title"] as? String ?? "").lowercased()
        if label == "album" { result["album"] = entry["text"] }
        if ["bpm", "tempo", "темп"].contains(label.trimmingCharacters(in: .whitespacesAndNewlines)), let text = entry["text"] as? String,
          let tempo = Double(text.replacingOccurrences(of: "bpm", with: "", options: .caseInsensitive).trimmingCharacters(in: .whitespacesAndNewlines)), tempo.isFinite, (40...200).contains(tempo) { result["tempo"] = tempo }
      }
    }
    if cached.count >= 20 { cached.removeAll() }
    cached[signature] = (Date().addingTimeInterval(600), result)
    return result
  }
}

private final class FingerprintResponse {
  let ready = DispatchSemaphore(value: 0)
  var data: Data?
  var response: URLResponse?
  var failure: Error?
  func finish(_ data: Data?, _ response: URLResponse?, _ failure: Error?) {
    self.data = data; self.response = response; self.failure = failure
    ready.signal()
  }
}
