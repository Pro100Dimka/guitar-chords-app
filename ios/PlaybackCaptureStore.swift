import Foundation
import UserNotifications

/// Only the app and its signed ReplayKit extension can access these short-lived samples.
struct PlaybackCaptureStore {
  static let appGroup = "group.com.freetune.recognition"
  static let maximumSamples = 12 * 16000
  struct Request: Codable {
    let id: UUID
    let expires: Date
  }
  struct Result: Codable {
    let id: UUID
    let error: String?
    var song: Data? = nil
    var identified: Bool = false
  }
  let directory: URL

  static func shared() throws -> PlaybackCaptureStore {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
      throw failure("PlaybackCaptureUnavailable")
    }
    return PlaybackCaptureStore(directory: container.appendingPathComponent("SongRecognition", isDirectory: true))
  }
  static func failure(_ code: String) -> NSError { NSError(domain: code, code: 1) }
  private var requestURL: URL { directory.appendingPathComponent("request.json") }
  private func session(_ request: Request) -> URL { directory.appendingPathComponent(request.id.uuidString, isDirectory: true) }

  func begin() throws -> Request {
    // A previous process may have died while recording. Its UUID can never be reused.
    if let old = request() { remove(old) }
    if let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
      for file in files where UUID(uuidString: file.lastPathComponent) != nil { try? FileManager.default.removeItem(at: file) }
    }
    let next = Request(id: UUID(), expires: Date().addingTimeInterval(180))
    try FileManager.default.createDirectory(at: session(next), withIntermediateDirectories: true)
    var values = URLResourceValues(); values.isExcludedFromBackup = true
    var location = directory; try? location.setResourceValues(values)
    try JSONEncoder().encode(next).write(to: requestURL, options: .atomic)
    return next
  }
  func request() -> Request? {
    guard let data = try? Data(contentsOf: requestURL), data.count <= 4096 else { return nil }
    return try? JSONDecoder().decode(Request.self, from: data)
  }
  func isCurrent(_ value: Request) -> Bool {
    guard let current = request() else { return false }
    return current.id == value.id && current.expires > Date() && FileManager.default.fileExists(atPath: session(value).path)
  }
  func result(_ value: Request) throws -> Result? {
    let url = session(value).appendingPathComponent("result.json")
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    let size = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
    guard size <= 512000 else { throw Self.failure("PlaybackCaptureFailed") }
    let data = try Data(contentsOf: url)
    let result = try JSONDecoder().decode(Result.self, from: data)
    guard result.id == value.id else { throw Self.failure("PlaybackCaptureFailed") }
    return result
  }
  func samples(_ value: Request) throws -> [Int16] {
    let url = session(value).appendingPathComponent("audio.pcm")
    let size = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
    guard (64000...Self.maximumSamples * 2).contains(size), size % 2 == 0 else { throw Self.failure("PlaybackAudioUnavailable") }
    let bytes = [UInt8](try Data(contentsOf: url))
    guard bytes.count == size else { throw Self.failure("PlaybackCaptureFailed") }
    return stride(from: 0, to: bytes.count, by: 2).map { Int16(bitPattern: UInt16(bytes[$0]) | UInt16(bytes[$0 + 1]) << 8) }
  }
  func complete(_ value: Request, samples: [Int16], error: String? = nil, song: [String: Any]? = nil, identified: Bool = false) throws {
    guard isCurrent(value) else { throw Self.failure("Cancelled") }
    if error == nil && !identified {
      guard (32000...Self.maximumSamples).contains(samples.count) else { throw Self.failure("PlaybackAudioUnavailable") }
      let littleEndian = samples.map(\.littleEndian)
      try littleEndian.withUnsafeBufferPointer { Data(buffer: $0) }.write(to: session(value).appendingPathComponent("audio.pcm"), options: .atomic)
    }
    guard isCurrent(value) else { remove(value); throw Self.failure("Cancelled") }
    let data = try song.map { try JSONSerialization.data(withJSONObject: $0) }
    try JSONEncoder().encode(Result(id: value.id, error: error, song: data, identified: identified)).write(to: session(value).appendingPathComponent("result.json"), options: .atomic)
  }
  func remove(_ value: Request) {
    // Deleting the UUID directory revokes this request without racing a newer request.json.
    try? FileManager.default.removeItem(at: session(value))
  }
}

enum RecognitionNotice {
  static func text(_ en: String, _ ru: String, _ uk: String) -> String {
    let language = Locale.preferredLanguages.first?.prefix(2).lowercased()
    return language == "ru" ? ru : language == "uk" ? uk : en
  }
  static func show(_ song: [String: Any]?, requestId: String, error: String? = nil, completion: (() -> Void)? = nil) {
    let content = UNMutableNotificationContent()
    content.title = "FreeTune"
    if let song = song, let title = song["title"] as? String, let artist = song["artist"] as? String {
      content.body = "\(artist): \(title)"
      content.userInfo = ["recognitionRequestId": requestId]
    } else {
      content.body = error == nil
        ? text("Song not found", "Песня не найдена", "Пісню не знайдено")
        : text("Recognition failed. Check the connection and audio access.", "Не удалось распознать. Проверьте подключение и доступ к звуку.", "Не вдалося розпізнати. Перевірте з’єднання та доступ до звуку.")
    }
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
    guard (200..<300).contains(http.statusCode), let data = response.data else { throw error("ServiceUnavailable") }
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
