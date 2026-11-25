import AppIntents
import SwiftUI
import WidgetKit

@main
struct RecognitionControls: WidgetBundle {
  var body: some Widget { PhoneAudioControl(); MicrophoneControl() }
}

struct PhoneAudioControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.freetune.recognition.playback") {
      ControlWidgetButton(action: OpenRecognitionIntent(target: .playback)) {
        Label("Phone audio", systemImage: "waveform")
      }
    }
    .displayName("Recognize phone audio")
    .description("Recognize phone audio and find lyrics with chords.")
  }
}

struct MicrophoneControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.freetune.recognition.microphone") {
      ControlWidgetButton(action: OpenRecognitionIntent(target: .mic)) {
        Label("Microphone", systemImage: "mic")
      }
    }
    .displayName("Recognize with microphone")
    .description("Listen to a song nearby and find lyrics with chords.")
  }
}
