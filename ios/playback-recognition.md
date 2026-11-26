# iPhone song recognition

Adding a song offers **Manual** and **Recognize**. Recognize starts listening immediately and opens the song form after finding its words and chords. There is no source selector or broadcast sheet. Legacy phone-audio links use the same listening action.

On iOS 17 and later, `SHManagedSession` manages capture, including supported audio playing through headphones. A local `SHCustomCatalog` returns the captured query signature; the existing HTTPS recognizer identifies it. The app does not request a Shazam App ID service or App Group. On iOS 15.1 and 16, the existing microphone capture remains available and mixes with other playing audio.

On iOS 18 and later, **FreeTune > Recognize** in Control Center starts listening in the app process and animates a Live Activity. A match posts a notification and opens the prepared song form. A miss posts a notification without opening the app. Cancellation stops the system recording and pending recognition request.

The delivered app embeds only `RecognitionControl`. The ReplayKit broadcast target is excluded from the app's build dependencies and embedded extensions. Sideloadly must preserve `RecognitionControl` when signing the IPA.

Native verification covers local-catalog query signatures, request serialization, managed-session cancellation and the existing microphone fallback. A device Release build checks the public ShazamKit APIs and embedded control. Actual capture from the desired player and headphones still requires a physical iPhone check.

- [Managed sessions](https://developer.apple.com/documentation/shazamkit/shmanagedsession)
- [Apple's managed-session and headphone demonstration](https://developer.apple.com/videos/play/wwdc2023/10051/)
- [Audio recording intents and Live Activities](https://developer.apple.com/documentation/appintents/audiorecordingintent)
