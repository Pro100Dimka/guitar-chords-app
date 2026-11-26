# iPhone song recognition

## Supported paths

The microphone path keeps other audio sessions playing with `mixWithOthers` and permits stereo Bluetooth output (`allowBluetoothA2DP`). Internal phone audio uses the separate ReplayKit Broadcast Upload extension and local notifications; it does not require microphone permission or an App Group. Both paths are available from iOS 15.1, the application's existing minimum version.

Adding a song offers **Manual** and **Recognize**. Recognition starts immediately, choosing phone audio while another app is playing music and the microphone otherwise. Audio-file and TXT/ChordPro import are no longer offered in this menu or recognition screen.

On iOS 18 or later, add **FreeTune → Recognize** from the Control Center gallery. Its `AudioRecordingIntent` starts a seven-second microphone capture in the app process without opening its interface. A Live Activity stays active during capture, as required by iOS. A match is saved before posting its notification and returning an `OpenRecognitionIntent` to open the form. A miss posts a notification and ends without opening the app. The microphone can hear phone speakers; it cannot capture audio routed exclusively to headphones. Direct capture of another app requires ReplayKit consent.

For phone audio, tap the visible system broadcast button, confirm **Start Broadcast**, and return to the player. The upload extension captures and identifies the permitted audio independently of the suspended main app, then posts a found/not-found notification. Tapping a found notification opens the saved result and looks up available chords without listening again. ReplayKit extensions cannot automatically bring their containing app to the foreground. If FreeTune remains open, its pending recognition request consumes the extension's result directly. Cancel or dismissing FreeTune's sheet cancels the request. A request that never starts expires after three minutes. A missing extension, denied notification permission, picker presentation failure, capture errors and network errors are reported explicitly.

## Signing and installation

The Xcode `freetune` scheme builds and embeds these targets automatically:

| Target | Bundle identifier | Minimum iOS |
| --- | --- | --- |
| freetune | `com.freetune` | 15.1 |
| PlaybackBroadcast | `com.freetune.PlaybackBroadcast` | 15.1 |
| RecognitionControl | `com.freetune.RecognitionControl` | 18.0 |

The app and broadcast extension do not request App Group entitlements. This avoids depending on a shared container that can be unavailable after personal-account IPA signing. Sign and embed both extensions with the same team as the containing app, preserving them when using Sideloadly. The control's intent belongs to both app and widget targets; its `AudioRecordingIntent`/`LiveActivityIntent` implementation runs in the app process. The widget target uses the `RECOGNITION_CONTROL` compilation condition and contains the Live Activity presentation.

An unsigned build verifies compilation and embedding. Signing or sideloading must preserve embedded extensions. The picker discovers the embedded broadcast extension's actual bundle identifier, including after a bundle-ID change. Phone audio recognition requires notification permission to deliver its result; denial reports an actionable error before capture starts.

## Capture and cleanup

ReplayKit's handler accepts **only app-audio buffers**. Video and microphone buffers are discarded immediately. It converts allowed audio to mono, 16 kHz, signed 16-bit PCM, collects at most **12 seconds of audio** and stops collection within **20 seconds**. Identification then uses a request with a 15-second network timeout. Initial silence is skipped. Silent or unavailable/protected audio produces `PlaybackAudioUnavailable`.

Captured PCM stays in memory during fingerprint identification; only the fingerprint is sent over HTTPS. No audio or handoff files are created. The result notification carries a UUID, capture start time, error status and song metadata without lyrics. The app receives it in the foreground, consumes a delivered notification on return, or saves its metadata when tapped after a cold launch. Capture time checks reject stale notifications. Cancellation uses a Darwin notification to stop the extension's capture and pending network task without a shared container. The app and extension share the existing fingerprint recognizer and capture cancellation helper. ReplayKit exposes `finishBroadcastWithError` to end a broadcast, so its completion notice can use the broadcast-stopped presentation even after success.

The app waits up to three minutes for system consent and the result; this does not extend audio collection. If iOS terminates the main app, tapping a completed result notification restores its metadata without recording again. Protected content and players that withhold audio can provide silence.

## Verification

JavaScript regression checks cover the two-option add menu, automatic source selection, saved-result routing without a second capture, and playback without decoding a disabled room impulse. Native fixtures check independent extension identification with HTTP doubles and session reactivation on repeated fingering taps. These fixtures and the complete Xcode application build require macOS; neither establishes physical iPhone behavior.

**Physical iPhone validation is still required:** test Control Center cold/warm/repeated launch, microphone capture while music plays, ReplayKit through the desired player and headphones, notification permission/taps, system-picker cancellation, navigation cancellation, return from the background, silence/protected content, and Sideloadly preserving both extensions. Simulator/fixture results do not establish device capture behavior.

## Apple API references

- [Mixing with other audio sessions](https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/mixwithothers)
- [ReplayKit system broadcast picker](https://developer.apple.com/documentation/replaykit/rpsystembroadcastpickerview)
- [Broadcast sample buffer lifetime and unavailable audio](https://developer.apple.com/documentation/replaykit/rpbroadcastsamplehandler/processsamplebuffer(_:with:))
- [Ending a broadcast from its upload extension](https://developer.apple.com/documentation/replaykit/rpbroadcastsamplehandler/finishbroadcastwitherror(_:))
- [Creating system controls and OpenIntent target membership](https://developer.apple.com/documentation/widgetkit/creating-controls-to-perform-actions-across-the-system)
- [Audio recording intents and required Live Activities](https://developer.apple.com/documentation/appintents/audiorecordingintent)
