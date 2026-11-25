import AppIntents
import Foundation

/// The intent runs in the main app. Keep the URL until React's linking layer consumes it.
enum RecognitionLaunch {
  static let notification = Notification.Name("FreeTuneRecognitionLaunch")
  private static let key = "FreeTuneRecognitionLaunchURL"
  private static let createdKey = "FreeTuneRecognitionLaunchDate"
  static func open(_ source: String) {
    let url = "freetune://recognize/\(source)?autoStart=true&requestId=\(UUID().uuidString)"
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
  case mic, playback
  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Audio source")
  static var caseDisplayRepresentations: [RecognitionSource: DisplayRepresentation] = [
    .mic: DisplayRepresentation(title: "Microphone"),
    .playback: DisplayRepresentation(title: "Phone audio")
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
