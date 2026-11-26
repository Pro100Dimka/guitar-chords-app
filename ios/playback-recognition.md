# iPhone song recognition

## Supported paths

The microphone path keeps other audio sessions playing with `mixWithOthers` and permits stereo Bluetooth output (`allowBluetoothA2DP`). Internal phone audio uses the separate ReplayKit Broadcast Upload extension; it does not require microphone permission. Both paths are available from iOS 15.1, the application's existing minimum version.

Adding a song offers **Manual** and **Recognize**. Recognition starts immediately, choosing phone audio while another app is playing music and the microphone otherwise. Audio-file and TXT/ChordPro import are no longer offered in this menu or recognition screen.

On iOS 18 or later, add **FreeTune → Recognize** from the Control Center gallery. Its `AudioRecordingIntent` starts a seven-second microphone capture in the app process without opening its interface. A Live Activity stays active during capture, as required by iOS. A match is saved before posting its notification and returning an `OpenRecognitionIntent` to open the form. A miss posts a notification and ends without opening the app. The microphone can hear phone speakers; it cannot capture audio routed exclusively to headphones. Direct capture of another app requires ReplayKit consent.

For phone audio, tap the visible system broadcast button, confirm **Start Broadcast**, and return to the player. The upload extension captures and identifies the permitted audio independently of the suspended main app, then posts a found/not-found notification. Tapping a found notification opens the saved result and looks up available chords without listening again. ReplayKit extensions cannot automatically bring their containing app to the foreground. If FreeTune remains open, its pending recognition request consumes the extension's result directly. Cancel or dismissing FreeTune's sheet cancels the request. A request that never starts expires after three minutes. Missing extension/App Group access, failure to present the picker, capture errors and network errors are reported rather than silently falling back to microphone capture.

## Signing and installation

The Xcode `freetune` scheme builds and embeds these targets automatically:

| Target | Bundle identifier | Minimum iOS |
| --- | --- | --- |
| freetune | `com.freetune` | 15.1 |
| PlaybackBroadcast | `com.freetune.PlaybackBroadcast` | 15.1 |
| RecognitionControl | `com.freetune.RecognitionControl` | 18.0 |

Register **`group.com.freetune.recognition`** for the signing team and include it in the provisioning profiles of **freetune** and **PlaybackBroadcast**. Both targets declare the matching App Group entitlement. Sign and embed both extensions with the same team as the containing app. The control's intent belongs to both app and widget targets; its `AudioRecordingIntent`/`LiveActivityIntent` implementation runs in the app process. The widget target uses the `RECOGNITION_CONTROL` compilation condition and contains the Live Activity presentation.

An unsigned build can verify compilation and embedding; it cannot grant App Group access on a physical device. Signing or sideloading must preserve embedded extensions and entitlements. The picker discovers the embedded broadcast extension's actual bundle identifier. If changing App Groups, update the store and both entitlements together. If shared-container access is unavailable, the app reports `PlaybackCaptureUnavailable`.

## Capture and cleanup

ReplayKit's handler accepts **only app-audio buffers**. Video and microphone buffers are discarded immediately. It converts allowed audio to mono, 16 kHz, signed 16-bit PCM, captures at most **12 seconds of audio** and stops within **20 seconds** after the broadcast begins. Initial silence is skipped. Silent or unavailable/protected audio produces `PlaybackAudioUnavailable`.

Each request owns a fresh UUID directory in the App Group. The extension checks that it remains current before publishing a bounded JSON result. Captured PCM stays in memory during fingerprint identification; only the fingerprint is sent over HTTPS. App consumption, cancellation and timeout remove the request directory; starting a request also removes leftovers. The directory is excluded from backups. The app and extension share the existing fingerprint recognizer. The extension builds its archive through the existing Cargo cache into a distinct Xcode output directory. ReplayKit exposes `finishBroadcastWithError` to end a broadcast, so its completion notice can use the broadcast-stopped presentation even after success.

The three-minute request expiry does not extend audio recording. If iOS terminates the main app, the completed extension result can still be consumed from its notification until a new request replaces it. Protected content and players that withhold audio can provide silence.

## Verification

The changed native code has not yet been compiled or exercised on an iPhone. Existing native fixtures describe the previous capture-only extension and need adjustment before they can verify the independent identification path. No automated tests or application builds were run for these changes.

**Physical iPhone validation is still required:** test Control Center cold/warm/repeated launch, microphone capture while music plays, ReplayKit through the desired player and headphones, system-picker cancellation, navigation cancellation, return from the background, silence/protected content, and signed App Group access. Simulator/fixture results do not establish device capture behavior.

## Apple API references

- [Mixing with other audio sessions](https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/mixwithothers)
- [ReplayKit system broadcast picker](https://developer.apple.com/documentation/replaykit/rpsystembroadcastpickerview)
- [Broadcast sample buffer lifetime and unavailable audio](https://developer.apple.com/documentation/replaykit/rpbroadcastsamplehandler/processsamplebuffer(_:with:))
- [Ending a broadcast from its upload extension](https://developer.apple.com/documentation/replaykit/rpbroadcastsamplehandler/finishbroadcastwitherror(_:))
- [Creating system controls and OpenIntent target membership](https://developer.apple.com/documentation/widgetkit/creating-controls-to-perform-actions-across-the-system)
- [Audio recording intents and required Live Activities](https://developer.apple.com/documentation/appintents/audiorecordingintent)
