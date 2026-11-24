# Incremental native builds

## CI

`ios-application` uses the standard Apple Silicon `macos-15` runner and
Xcode 16.4. The simulator Debug build and the optional iPhone Release/IPA build
have separate cache namespaces. Both still invoke the complete Xcode build.

The reusable state is:

- Locked CocoaPods dependencies, Skia's prepared Apple frameworks and Cargo
  downloads. Restore the complete Pods/Skia pair after `npm ci`: Skia's pod
  preparation writes into `node_modules`, which a fresh npm install recreates.
- Xcode DerivedData, including the Rust target directory used by the app.
- Android Gradle dependencies, transformed artifacts and task cache, plus
  Cargo dependencies for the three Android architectures.

iOS cache identity includes the OS/build, architecture, Xcode and SDK versions,
Rust/Node/Ruby versions, workspace and build paths, configuration, build flags,
lockfiles, native project/build configuration and dependency patches. A source
change can reuse compatible dependency objects; a toolchain/configuration
change starts a new cache namespace.

A new checkout gives unchanged files new timestamps. After installing locked
dependencies, `scripts/ios-build-cache.py` compares the input path, SHA256, size
and mode with the successful build's snapshot. Only identical regular files
regain their previous timestamps. Changed files get a fresh timestamp, including
files unpacked from archives with old dates. Added/removed paths or changed
symlink targets invalidate the build cache, since they can alter header lookup.
Symlinks are not followed. Invalid/missing metadata also discards the restored
DerivedData and builds normally.
The helper's regression tests run before every iOS app build.

Skia 2.5.1 conditionally adds tvOS framework declarations when its prepared tvOS
directory exists. During the iOS deployment installation, the workflow temporarily
moves that cached directory aside so evaluation matches the fresh npm state and
the committed lockfile. An exit handler restores it before input validation; it
also preserves installation failures and keeps a backup if restoration fails.

Xcode indexing is disabled in CI; application compilation, linking and the device
package integrity checks remain enabled. The Rust fingerprint phase still runs
Cargo's dependency checks, but leaves its final static library untouched when
the produced bytes are unchanged, avoiding an unnecessary application relink.

Android builds the JNI library once through the existing Gradle `preBuild`
dependency, in the generated directory consumed by the app. CI verifies outputs
for `armeabi-v7a`, `arm64-v8a` and `x86_64`. The native task builds only the
library; host tests and the recognition probe remain separate checks. The pinned
official cargo-ndk binary is verified by SHA256 instead of compiling that tool
from source on every runner.

Live audio downloads, decoding and Shazam requests run in the independent
`shazam-real-audio-proof` workflow. Its known positive Gloria assertion remains
mandatory; the additional public-domain recordings remain optional probes.
The Android compiler job does not wait for those network operations.
PRs restore Gradle's shared state without uploading a new multi-gigabyte remote
cache on every commit. Successful `main` builds publish the shared Gradle cache;
normal local Gradle task caching remains enabled in every build.

## Measure the complete job

The previous successful iOS job took **30 min 58 s**, including **27 min 17 s**
in Xcode. The Android/native job took **7 min 31 s**, including **4 min 35 s**
in Gradle. These are the pre-change baselines, not promises about new runs:

- [iOS baseline](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45474476716/job/138730898336)
- [Android baseline](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45474476610/job/138730899313)

Compare both the first successful run and a second run of the same PR job.
GitHub scopes PR caches to that PR; a dispatch on the source branch is a
different cache scope. Default-branch caches become available to subsequent
PRs after a successful `main` build. Cache misses after an SDK, dependency or
build configuration update are expected.

Use total job duration as well as compiler duration: download, extraction and
cache upload also cost time. The iOS proof artifact includes the complete
`-showBuildTimingSummary` log, toolchain/cache context and cache sizes. Gradle's
setup action supplies its cache report. Superseded PR runs are cancelled so
they do not compete with the newest commit.

## Local development

Keep the normal Xcode DerivedData, Gradle and Cargo build directories between
builds. Use the same workspace, configuration and architecture for comparable
timings. Do not run `clean`, delete Pods or clear build caches as a routine
prerequisite. A clean build remains useful when specifically diagnosing a
cache-related failure.

For iOS, open `ios/freetune.xcworkspace`. Install pods with
`bundle exec pod install --project-directory=ios` after installing or changing
native dependencies; rebuilding unchanged dependencies before every edit is
unnecessary. The fingerprint build phase respects an explicit
`CARGO_TARGET_DIR`, otherwise it retains its target directory in DerivedData.

For Android release builds, retain the persistent output/cache directories
described in [Android builds](android-builds.md). Ordinary JavaScript/UI edits
can use Metro and Fast Refresh during development; native source/dependency
changes still require a native build.

References: [React Native prebuilt iOS core](https://reactnative.dev/blog/2026/02/11/react-native-0.84),
[GitHub cache scoping](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching),
[Gradle setup cache](https://github.com/gradle/actions/blob/v4/docs/setup-gradle.md).
