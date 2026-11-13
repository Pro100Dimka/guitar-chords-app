## Audio song analysis (Android)

Import MP3/WAV/M4A into the library, analyze singing and harmony with the free
analysis backend, and practice using the original audio and editable timestamps.
The shared-service client uses automatic installation access; ordinary users do
not enter a server address or token. **No public developer service is deployed
yet**: the bundled URL is deliberately empty and ordinary analysis is disabled
with an explanation. Developer deployment files and the compatible private-server
mode are included. No APK was built for this update.

- [Setup and user guide (Russian)](docs/audio-song-analysis.md)
- [Backend setup, models and HTTP contract](backend/README.md)
- [Model code/weight licenses](backend/MODEL_LICENSES.md)
- [Measured validation and limitations](docs/validation/README.md)

This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

## Release signing and database upgrades

### Store preparation

The current build is a release candidate, not an approved store release.
Developer contact: Андреев Дмитрий, pro100dimka.and@gmail.com.
Android and iOS use `com.freetune`. Register this identifier in both developer
accounts before the first submission, or change it in both native projects if
unavailable. Select your own Apple signing team in Xcode; no team is preselected.

Settings includes voluntary developer support through the native stores. Create
`freetune_support` as a consumable in App Store Connect and a one-time product
in Google Play Console. Activate its purchase option, set pricing and regional
availability, and complete payment/tax agreements. Prices come from the store;
there is no subscription or digital entitlement. Without a configured product,
the app shows an unavailable message and never invents a price or payment link.
Transactions are consumed only after the store reports `purchased`. Pending
transactions are recovered at launch; duplicate callbacks are ignored. No server
entitlement is granted. Adding paid features later requires a separately designed
receipt verification and entitlement system.

On macOS, run `bundle exec pod install` from `ios` to integrate NitroIap, then
build/archive in Xcode and test StoreKit sandbox purchases, cancellation, pending
approval and relaunch recovery. Test the same paths through Google Play internal
testing and license testers. Unit tests use store mocks and do not prove real
payments. No production payment is configured until the store accounts exist.

Publish `docs/privacy.html` to a permanent, public HTTPS address, add that address
to both store listings and expose the hosted link from Settings alongside the
offline policy. Keep the hosted and in-app texts synchronized. Complete store
privacy/data-safety forms for the final binary, including embedded YouTube and
store billing, rather than selecting "no data" without reviewing third parties.

The tuner stickers use original musical illustrations. Review all final store
artwork and the documented third-party audio licenses before submission.

Build 6 has a signed Android App Bundle with the preserved upload key, verified
archive integrity and 16 KB ELF alignment for all 21 arm64 libraries. Remaining
release checks require Google Play processing, an iOS archive, physical Android/
iPhone microphone tests, audio interruptions, screen sizes, accessibility text
scaling, offline storage and real sandbox billing. Register the developer
accounts and complete any testing requirements shown by the store consoles.

Dependency overrides update the Node-only SQLite adapter, Metro image parsing,
and modern glob/minimatch consumers to patched versions. Legacy glob 7/8 consumers
retain their callback API. The Babel module resolver is pinned to 5.0.0 because
its default glob import is incompatible with newer glob exports. The remaining dependency audit warnings concern
deepmerge 4 in the React Native CLI and Jest configuration, not Formik's separate
deepmerge 2 dependency. Only build trusted project configurations; reassess the
overrides when upgrading these tools. A dependency audit is not a complete
security review or proof that the application has no vulnerabilities.

The Metro patch in `patches/metro+0.83.5.patch` reads image bytes before calling
image-size 2, which no longer accepts file paths. The existing `postinstall`
command applies this patch. Do not skip install scripts in release environments;
check both production bundles with a clean Metro cache when updating image tools.

Release preparation (build 6): 71 JavaScript tests, SQLite integration and Android
native regression checks pass. Type checking, lint and signed bundle verification
are recorded with the release artifacts. Physical device testing, iOS native
compilation and real store billing remain unverified. Store copy and submission
notes are in `docs/store-listing.json` and `docs/release-readiness.json`.

The current Android pitch regression suite passes 270 synthetic accuracy cases
(maximum error 0.354 cents), 180 string transitions, 12 decay/drift sequences,
ten guitar recordings and 200 capture start/stop cycles. These are software
checks with deterministic device stubs, not physical microphone certification.
The matching subharmonic tracking correction is also applied to the Swift source;
the iOS native checks must still run on macOS.

The current audition bank contains 24 major/minor chords, six distinct strums per
chord and five-second decay tails from Strummed Acoustic. Directional recordings
are used for standard voicings; alternate fingerings and extended chords use
individual notes from the same library. Tuner reference strings use Meta Steel
Guitar (CC0). The packaged MP3 bank passed decoding checks for all 144 takes with
peak 0.760 or less and near-zero endings. Device playback still needs audition.
Native Instruments EULA section 3.7 distinguishes music production from using
samples as a library in another sample-based product. Embedding permission has
not been established. Do not submit the current bank publicly without appropriate
permission or a replacement licensed for app embedding. See the asset license
files. File conversion and processing do not establish redistribution permission.

Preferences tests cover save failures, reloads and backup preservation of covers,
performer names, lyrics and selected chord shapes.

Android release builds require `RELEASE_STORE_FILE` (absolute keystore path),
`RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, and `RELEASE_KEY_PASSWORD` in the
build environment. Keep the keystore and passwords outside the repository.
Release builds use this signing configuration exclusively. Private RC APKs 4
and 5 were signed with the debug key for device evaluation; they are not store
artifacts. The store AAB uses the separate upload key. Preserve the release key for subsequent updates.

Database upgrades use SQLite `user_version` in `src/components/database/initTables.ts`.
Version 1 adopts existing tables without deleting their contents. Add future
migrations after the existing entries, using explicit SQL; do not rewrite applied
migrations. Schema changes and their version update run in one transaction. Test
upgrades against a populated previous-version database and verify rollback on
failure before shipping. An older app refuses a newer database version.

Run `npm test -- --runInBand`, `npm run lint -- --max-warnings 0`, and
`npx tsc --noEmit` for JavaScript checks. With Node 22.13 or newer,
`npm run test:sqlite` additionally checks CRUD, transaction failure, migration
rollback, and preservation of existing records against SQLite in memory.

On Windows, `./test-native.ps1 -KotlinLib <compiler-lib-directory>` compiles the
actual Android microphone module with deterministic device stubs. It checks
200 capture lifecycle cycles, silence events, and 270 synthetic cases covering
detuning, noise, dominant overtones, and 44.1/48 kHz input. It also checks quiet
tones, DC offset, tuning direction, settling, string transitions, and the dominant
register of ten guitar recordings. The sequence checks cover 180 string changes
at different levels and 12 decays with gradual detuning. They reject register
jumps after acquisition in the evaluated recording segments and verify that
tracking retains at least 80% of frames accepted by the pitch detector.
The directory must contain the Kotlin JVM compiler, standard library and
annotations JARs (for example, the `lib` directory of Gradle 8.14.3).
Use `-OutputDirectory` to choose the scratch directory. These checks do not replace
an Android device test or an iOS build and audio test in Xcode.

On macOS, run `python3 test-ios-pitch.py` to compile the actual Swift estimator and
smoothing methods with Accelerate and exercise the synthetic signal matrix,
transitions, decays, and the same ten WAV recordings.
The runner requires Swift, uses temporary files, and removes them afterward.
It does not test AVAudioSession or microphone hardware. The iOS check has not
been executed on the Windows development machine.

The recordings are not calibrated references: their dominant register is checked
within one semitone, and frame-level register consistency is printed separately.
Tracking checks current spectral support before following a sustained note
through an octave or subharmonic ambiguity. New notes require two consistent
frames. Uncertain frames produce no pitch; internal context expires after three
consecutive misses and resets on silence or capture shutdown. Loud background
noise is not counted as a reliably pitched signal simply because its RMS is high.
A passing file-based check does not establish flawless live tuning. Before
release, verify all six strings, deliberate detuning, decay, noise, rapid string
changes, and audio interruption/recovery on physical Android and iPhone devices.

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.


## Song library and practice

- Library: create a song with only a title and lyrics, or open the original practice example from the empty library. Artist and video links are optional.
- Import: choose a UTF-8 TXT, PRO, CHO or ChordPro file through the system file picker. The title directive is extracted, bracketed chords are rendered, and other directives remain visible for review. Import does not silently change the capo or sounding key. Existing drafts require confirmation before replacement.
- Settings > Library backup: save a portable JSON copy or preview a copy before restoring. Songs and their favorites, fingerings, rhythm and reading settings are included. Restore is transactional and only appends missing songs; matching title, content, artist and links are skipped with existing preferences preserved. Limits: 50 MB per library backup, 5 MB per text import, 2,000 songs, 200,000 characters per song. Audio-song annotations and edits are included in version 2 backups; original MP3/WAV/M4A recordings are kept separately and must be relinked by SHA-256 after restore. Version 1 backups remain supported. Keep exported files somewhere safe; cloud storage, if selected in the system picker, is managed by its provider.
- Song > Reading > Play more easily: compare fingerings for capo positions 0 through 7 while preserving the sounding key and original text. Suggestions assume standard guitar tuning and use a fingering-complexity estimate. The previous position can be restored while the panel remains open.
- Song > Practice: play the entire chord sequence from the song, including repeated chords. Select a starting chord and tempo for a one-minute session, with one chord per bar. This is a timing guide, not microphone-based playing assessment. Backgrounding the app stops playback.
- Rhythm previews use the song's chords, selected fingerings and capo. The standalone catalog uses an example progression. The current Strummed Acoustic bank is for private evaluation pending embedding permission; reference strings use Meta Steel Guitar (CC0). Source notices are in assets/strummed-acoustic.LICENSE.txt and assets/guitar-samples.LICENSE.txt.
- Fingerings include the curated shapes followed by generated alternatives across the neck, filtered for chord tones, bass and fretting reach. More shapes load on demand. Diagrams assume standard six-string tuning.
- Song > Record: record voice and guitar locally as AAC/M4A while reading the song, then listen, export or delete takes. After capture, local background processing reduces low rumble, gently compresses levels and adds a small room effect. Processing writes a temporary AAC file and replaces the take only on success; no separate original is retained. On failure the unprocessed take stays available. Playback, export and deletion are disabled while that take is processing. Native encoding and microphone quality still require Android and iOS device checks. Recording stops on leaving the screen or backgrounding the app, and is limited to 30 minutes. Recordings are not included in the JSON library backup; export important takes separately. Uninstalling the app removes its local recordings.
- Guitar tuner: 33 preset tunings and editable six-string tuning. The note fills green after holding within 5 cents for 1.1 seconds, followed by an optional soft confirmation sound. The cue is excluded from pitch feedback briefly to avoid triggering itself. Very low tunings require suitable strings and instrument setup.

The file picker and file access modules require a native rebuild, including CocoaPods installation on macOS for iOS. Before release, manually verify file selection, cancellation, export and restore on physical Android and iPhone devices, along with the existing live tuner checklist.
