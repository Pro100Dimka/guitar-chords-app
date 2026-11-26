import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct RecognitionControls: WidgetBundle {
  var body: some Widget { RecognitionControl(); RecognitionActivity() }
}

struct RecognitionControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.freetune.recognition.playback") {
      ControlWidgetButton(action: RecognizeSongIntent()) {
        Label("Recognize", systemImage: "waveform")
      }
    }
    .displayName("Recognize")
    .description("Listen to a song and find its chords.")
  }
}

struct RecognitionActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RecognitionActivityAttributes.self) { _ in
      HStack {
        Image(systemName: "waveform").symbolEffect(.variableColor.iterative)
        Text("Listening…")
      }
      .padding()
      .foregroundStyle(.yellow)
      .activityBackgroundTint(.black)
      .activitySystemActionForegroundColor(.yellow)
    } dynamicIsland: { _ in
      DynamicIsland {
        DynamicIslandExpandedRegion(.center) {
          Label("Listening…", systemImage: "waveform")
        }
      } compactLeading: {
        Image(systemName: "waveform").symbolEffect(.variableColor.iterative)
      } compactTrailing: {
        Text("FreeTune")
      } minimal: {
        Image(systemName: "waveform").symbolEffect(.variableColor.iterative)
      }
    }
  }
}
