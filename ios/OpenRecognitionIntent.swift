import ActivityKit
import AppIntents
import Foundation
#if !RECOGNITION_CONTROL
import AVFoundation
import UserNotifications
#endif

enum RecognitionLaunch {
  static let notification = Notification.Name("FreeTuneRecognitionLaunch")
  private static let key = "FreeTuneRecognitionLaunchURL"
  private static let createdKey = "FreeTuneRecognitionLaunchDate"
  private static let songKey = "FreeTuneRecognitionSong"
  private static let songIdKey = "FreeTuneRecognitionSongId"
  private static let songDateKey = "FreeTuneRecognitionSongDate"
  static func saveSong(_ song: [String: Any], requestId: String) {
    guard let data = try? JSONSerialization.data(withJSONObject: song) else { return }
    UserDefaults.standard.set(data, forKey: songKey)
    UserDefaults.standard.set(requestId, forKey: songIdKey)
    UserDefaults.standard.set(Date(), forKey: songDateKey)
  }
  static func consumeSong(_ requestId: String) -> [String: Any]? {
    guard UserDefaults.standard.string(forKey: songIdKey) == requestId,
          let created = UserDefaults.standard.object(forKey: songDateKey) as? Date,
          Date().timeIntervalSince(created) < 600,
          let data = UserDefaults.standard.data(forKey: songKey) else { return nil }
    for key in [songKey, songIdKey, songDateKey] { UserDefaults.standard.removeObject(forKey: key) }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }
  static func open(_ source: String, requestId: String? = nil) {
    let id = requestId ?? (source == "result" ? UserDefaults.standard.string(forKey: songIdKey) : nil) ?? UUID().uuidString
    let url = "freetune://recognize/\(source)?autoStart=true&requestId=\(id)"
    UserDefaults.standard.set(url, forKey: key)
    UserDefaults.standard.set(Date(), forKey: createdKey)
    NotificationCenter.default.post(name: notification, object: url)
  }
  static func consume() -> String? {
    let url = UserDefaults.standard.string(forKey: key)
    let created = UserDefaults.standard.object(forKey: createdKey) as? Date
    UserDefaults.standard.removeObject(forKey: key)
    UserDefaults.standard.removeObject(forKey: createdKey)
    return created.map { Date().timeIntervalSince($0) < 120 } == true ? url : nil
  }
}

@available(iOS 16.0, *)
enum RecognitionSource: String, AppEnum {
  case mic, playback, result
  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Audio source")
  static var caseDisplayRepresentations: [RecognitionSource: DisplayRepresentation] = [
    .mic: DisplayRepresentation(title: "Microphone"),
    .playback: DisplayRepresentation(title: "Phone audio"),
    .result: DisplayRepresentation(title: "Song found")
  ]
}

@available(iOS 16.0, *)
struct OpenRecognitionIntent: OpenIntent {
  static var title: LocalizedStringResource = "Find song chords"
  @Parameter(title: "Audio source") var target: RecognitionSource
  init() {}
  init(target: RecognitionSource) { self.target = target }
  @MainActor
  func perform() async throws -> some IntentResult {
    RecognitionLaunch.open(target.rawValue)
    return .result()
  }
}

@available(iOS 16.2, *)
struct RecognitionActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable { var listening: Bool }
}

@available(iOS 18.0, *)
struct RecognizeSongIntent: AudioRecordingIntent, LiveActivityIntent {
  static var title: LocalizedStringResource = "Recognize"
  static var openAppWhenRun: Bool { false }
  @MainActor
  func perform() async throws -> IntentResultContainer<Never, OpenRecognitionIntent, Never, Never> {
    #if RECOGNITION_CONTROL
    throw NSError(domain: "RecognitionUnavailable", code: 1)
    #else
    let granted = await withCheckedContinuation { continuation in
      AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) }
    }
    guard granted else {
      throw NSError(domain: "MicrophonePermissionDenied", code: 1, userInfo: [NSLocalizedDescriptionKey: RecognitionNotice.text("Allow microphone access in Settings", "Разрешите доступ к микрофону в настройках", "Дозвольте доступ до мікрофона в налаштуваннях")])
    }
    _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
    let activity = try Activity.request(attributes: RecognitionActivityAttributes(), content: ActivityContent(state: .init(listening: true), staleDate: Date().addingTimeInterval(40)), pushType: nil)
    let recognizer = SongRecognition.controlInstance ?? SongRecognition()
    let id = UUID().uuidString
    let song: [String: Any]?
    do {
      song = try await recognizer.recognizeFromControl()
    } catch {
      await activity.end(nil, dismissalPolicy: .immediate)
      RecognitionNotice.show(nil, requestId: id, error: (error as NSError).domain)
      throw error
    }
    await activity.end(nil, dismissalPolicy: .immediate)
    if let song = song { RecognitionLaunch.saveSong(song, requestId: id) }
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      RecognitionNotice.show(song, requestId: id, completion: { continuation.resume() })
    }
    guard song != nil else {
      throw NSError(domain: "SongNotFound", code: 1, userInfo: [NSLocalizedDescriptionKey: RecognitionNotice.text("Song not found", "Песня не найдена", "Пісню не знайдено")])
    }
    return .result(opensIntent: OpenRecognitionIntent(target: .result))
    #endif
  }
}
