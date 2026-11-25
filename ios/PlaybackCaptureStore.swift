import Foundation

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
    let data = try Data(contentsOf: url)
    guard data.count <= 4096 else { throw Self.failure("PlaybackCaptureFailed") }
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
  func complete(_ value: Request, samples: [Int16], error: String? = nil) throws {
    guard isCurrent(value) else { throw Self.failure("Cancelled") }
    if error == nil {
      guard (32000...Self.maximumSamples).contains(samples.count) else { throw Self.failure("PlaybackAudioUnavailable") }
      let littleEndian = samples.map(\.littleEndian)
      try littleEndian.withUnsafeBufferPointer { Data(buffer: $0) }.write(to: session(value).appendingPathComponent("audio.pcm"), options: .atomic)
    }
    guard isCurrent(value) else { remove(value); throw Self.failure("Cancelled") }
    try JSONEncoder().encode(Result(id: value.id, error: error)).write(to: session(value).appendingPathComponent("result.json"), options: .atomic)
  }
  func remove(_ value: Request) {
    // Deleting the UUID directory revokes this request without racing a newer request.json.
    try? FileManager.default.removeItem(at: session(value))
  }
}
