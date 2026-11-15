# Android builds

For a signed local test APK matching the existing test certificate:

```powershell
.\scripts\build-android.ps1 -TestSigning
```

ARM64 is the default. Use `-Abi armeabi-v7a` for a 32-bit phone, or `-Abi both`
when both installers are required. Without `-TestSigning`, configure the existing
`RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS` and
`RELEASE_KEY_PASSWORD` environment variables. Never commit signing credentials.

The command retains release lint, R8 and resource shrinking. It checks the
application ID, signature, 16 KB ZIP alignment and the 40,000,000-byte APK limit.
It does not replace the separate regression suite, native algorithm checks or
device testing required before release.

Java 17, Android SDK 36, NDK 27.1.12297006, Rust with Android targets and
`cargo-ndk` must be installed. Existing `CARGO_HOME`, `RUSTUP_HOME` and
`CARGO_TARGET_DIR` settings are respected. Cargo must be available on PATH when
the native library needs rebuilding. Rust uses `Cargo.lock` via `--locked`.

## Cache reuse

Gradle configuration caching, task-output caching and parallel execution are
enabled. Rust declares its source, manifest, lockfile, ABI and NDK inputs, and
writes compiled libraries under the build directory instead of changing tracked
libraries in `android/app/src/main/jniLibs`.

The script uses a persistent `E:\CodexTemp\freetune-build` cache. Override it with
`-CacheDirectory` when necessary. It reuses an existing ignored
`android/.release-output` junction and its build directory. On a fresh checkout,
it creates that junction pointing to the cache's `app-build` directory. The
junction keeps React Native's Windows bundle paths on the repository drive while
the actual output remains on E:. An existing ordinary directory at that path
causes an error rather than being replaced.

TEMP, TMP and Node compile caches are scoped to the build process and restored
afterward. Metro receives the same temporary directory on subsequent runs.
Existing Gradle caches are reused. These directories are reusable build state,
not disposable per-run copies. Do not clear them or run `gradlew clean` routinely.

Changes to tests and build scripts no longer invalidate the production JS bundle.
Application JS/TS, assets, package manifests, Babel and Metro configurations remain
tracked inputs. Git revision is an input to Android version-control metadata.

Do not bump `versionCode` just to time a rebuild. A real version change modifies
native application classes and can require R8 to run again. Increase it when
preparing the next distributable version. Dependency, ABI, native source and
toolchain changes can also require a longer build. After changing the installed
Rust compiler without changing sources, explicitly rebuild the native task with
`gradlew :app:buildSongFingerprintNative --rerun-tasks` using the same ABI and
build-directory properties as the normal command.

## Local measurements, 15 November 2026

On the existing 32 GB Windows workstation, with dependencies already installed:

| Scenario | Elapsed time |
| --- | ---: |
| Previous unchanged two-ABI Gradle invocation, before tuning | 8.6 s |
| First successful ARM64 pass after cache/output reconfiguration | 67.2 s |
| Warm ARM64 build, including package checks | 1.7 s |
| Warm two-ABI build, including package checks | 2.0 s |
| First pass after switching from one ABI to both | 147.6 s |
| JS entry-file invalidation with warm Metro, including package checks | 22.9 s |

The JS measurement appended a neutral comment to `index.js`, ran the real
Metro/Hermes pipeline, then restored the original bytes in a finally block.
Rust and R8 remained up to date. It measures JS invalidation, not every possible
feature change. The comparable warm two-ABI command fell from 8.6 s to 2.0 s, with the new
command also checking signature, alignment and size. Switching ABI sets still
rebuilds native dependency outputs, as the 147.6 s pass shows. Cold caches, version
bumps and dependency upgrades are not covered by the warm timings.

Gradle cache behavior: [official performance documentation](https://docs.gradle.org/9.0.0/userguide/performance.html).
