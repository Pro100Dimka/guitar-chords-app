# iPhone song recognition

## Supported paths

The microphone path keeps other audio sessions playing with `mixWithOthers` and permits stereo Bluetooth output (`allowBluetoothA2DP`). Internal phone audio uses the separate ReplayKit Broadcast Upload extension; it does not require microphone permission. Both paths are available from iOS 15.1, the application's existing minimum version.

On iOS 18 or later, add **FreeTune → Recognize phone audio** or **FreeTune → Recognize with microphone** from the Control Center gallery. The control opens the matching recognition screen. A fresh request ID permits repeated taps, while consumed or expired requests cannot restart capture after a later foreground transition.

For phone audio, tap the visible system broadcast button and confirm **Start Broadcast**, return to the player, then return to FreeTune within three minutes. The app's Cancel button or dismissing its sheet cancels the pending request. The system picker has no public dismissal callback; cancelling that system dialog returns to FreeTune's sheet, where Cancel remains available. A request that never starts expires after three minutes.

## Signing and installation

The Xcode `freetune` scheme builds and embeds these targets automatically:

| Target | Bundle identifier | Minimum iOS |
| --- | --- | --- |
| freetune | `com.freetune` | 15.1 |
| PlaybackBroadcast | `com.freetune.PlaybackBroadcast` | 15.1 |
| RecognitionControl | `com.freetune.RecognitionControl` | 18.0 |

Register **`group.com.freetune.recognition`** for the signing team and include it in the provisioning profiles of **freetune** and **PlaybackBroadcast**. Both targets already declare the matching App Group entitlement. Sign and embed both extensions with the same team as the containing app. The control's `OpenRecognitionIntent.swift` belongs to the app and widget targets so iOS runs the action in the foreground app.

An unsigned CI build verifies compilation and embedding; it cannot grant access to an App Group on a physical device. A signing or sideloading tool must preserve the embedded extensions and supported entitlements. If changing bundle identifiers, also change the ReplayKit picker's preferred extension and the App Group identifier/entitlements together. If shared-container access is unavailable, the app reports `PlaybackCaptureUnavailable` rather than attempting microphone capture.

## Capture and cleanup

ReplayKit's handler accepts **only app-audio buffers**. Video and microphone buffers are discarded immediately. It converts allowed audio to mono, 16 kHz, signed 16-bit PCM, captures at most **12 seconds of audio** and stops within **20 seconds** after the broadcast begins. Initial silence is skipped. Silent or unavailable/protected audio produces `PlaybackAudioUnavailable`.

Each request owns a fresh UUID directory in the App Group. The extension checks that the request remains current before processing and publishing results. The app validates the result UUID and file size, reads at most 384 KB of PCM, and deletes the files before fingerprint recognition. Cancel, timeout, and failures also remove that directory; a later request removes leftovers from a terminated process. The capture directory is excluded from backups. No raw audio is uploaded by the extension. ReplayKit exposes `finishBroadcastWithError` to end a broadcast from an upload extension, so its system completion notice may use the system's broadcast-stopped presentation even on a successful capture.

The three-minute request expiry does not extend audio recording. It only allows time to use the system picker and return to the foreground app. If iOS terminates the main app, its JavaScript promise cannot survive; start a new request after reopening. Audio cannot be captured from every player: protected content and applications that withhold audio may provide silence.

## Verification

`python3 test-ios-recognition.py` on macOS exercises the production microphone session options, background cancellation policy, shared-store cleanup, stale-session rejection, CoreMedia PCM conversion at 16/44.1/48 kHz in Float32/Int16/Int32, planar/interleaved stereo, 12-second bounds, silence handling, discarded video/microphone buffers, and consumed/expired shortcut requests. The complete Xcode application build additionally compiles both actual extensions and their App Intent metadata.

**Physical iPhone validation is still required:** test Control Center cold/warm/repeated launch, microphone capture while music plays, ReplayKit through the desired player and headphones, system-picker cancellation, navigation cancellation, return from the background, silence/protected content, and signed App Group access. Simulator/fixture results do not establish device capture behavior.

## Apple API references

- [Mixing with other audio sessions](https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/mixwithothers)
- [ReplayKit system broadcast picker](https://developer.apple.com/documentation/replaykit/rpsystembroadcastpickerview)
- [Broadcast sample buffer lifetime and unavailable audio](https://developer.apple.com/documentation/replaykit/rpbroadcastsamplehandler/processsamplebuffer(_:with:))
- [Ending a broadcast from its upload extension](https://developer.apple.com/documentation/replaykit/rpbroadcastsamplehandler/finishbroadcastwitherror(_:))
- [Creating system controls and OpenIntent target membership](https://developer.apple.com/documentation/widgetkit/creating-controls-to-perform-actions-across-the-system)
