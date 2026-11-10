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

Android release builds require `RELEASE_STORE_FILE` (absolute keystore path),
`RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, and `RELEASE_KEY_PASSWORD` in the
build environment. Keep the keystore and passwords outside the repository.
Release builds use this signing configuration exclusively; debug signing is
reserved for debug builds. Preserve the release key for subsequent updates.

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
