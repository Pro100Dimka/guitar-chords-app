# FreeTune song autofill — Android native recognition

Branch: `feature/song-autofill`. Started from `8039cbd9`; no merges with model branches or `main`. No APK assembled.

## Current implementation

- **On device**: Android AudioRecord captures 12 seconds, or MediaExtractor/MediaCodec reads a bounded 12-second section of an audio document via `content://` / `file://`. Decode runs on a dedicated executor, not the React Native UI thread. Input is converted to 16kHz mono PCM16 with bounded averaging/resampling. File selection reads the original provider URI directly; original audio is not changed or deleted.
- **Fingerprint**: JNI links a Rust library built with `cargo ndk` for `arm64-v8a` and `armeabi-v7a`. The source of the signal-processing and signature encoder is shazamio-core 2.1.0 pinned to `63f9583ee9729c95b9e9f10af6f2006d13df6fb2`, adapted for a direct PCM entrypoint without PyO3/Python.
- **Network**: Shazam's *unofficial* `amp.shazam.com/discovery/v5/en-US/GB/iphone/-/tag` HTTPS request sends a base64 signature and timing metadata, not raw recording audio. 10/15-second connection/read timeouts and per-429 `Retry-After` cooldown apply. No API token, server, Python, model or Oracle deployment is needed.
- **UI**: Android library has a Recognize song action, opening the existing add form; the same form supports microphone and audio-file recognition during add/edit. Confirm before replacing populated title/artist. A success sets existing `title` and `fk_band.name`, clears obsolete `fk_band.id`, preserves song `id`, existing lyrics, cover and links; then automatically invokes LRCLIB. The lyrics-only candidates stay reviewable, with album/duration and preview; a user must choose lyrics and press ordinary Save. No new database tables or records are created by recognition.
- **Lifecycle**: cancellation stops the microphone and disconnects the HTTP request. Audio is retained in a bounded memory buffer and not saved as a temporary file. There are no feature-created audio files to clean after crashes. The original file is never deleted. Late completion is guarded by request generations and form snapshots.
- Android-only UI actions are hidden on other platforms. Locales: English, Ukrainian, Russian.

## Source / license audit

- `shazamio-core` **2.1.0** is MIT; versions **up to and including 2.0.0** contained SongRec GPL-3.0+ code. Only the 2.1 source was adapted; original MIT text is in `android/song-fingerprint/UPSTREAM-LICENSE`. https://github.com/shazamio/shazamio-core
- `Audile` is GPL-3.0+; none of its implementation was copied. https://github.com/AudileTeam/Audile
- Rust JNI dependency `jni 0.21.1` is MIT/Apache-2.0; `chfft 0.3.4` is MPL-2.0. The unmodified `chfft` source is available at https://crates.io/crates/chfft/0.3.4; license text is in `CHFFT-MPL-2.0`. Binary redistribution must retain notices and MPL source availability. Also check resolved Cargo.lock transitive license inventory before a store release.
- LRCLIB remains a lyrics-only fallback, never a chord provider; no chord sources were added. Site copyright/redistribution permissions need separate review.
- Shazam is an unofficial endpoint with no contractual availability guarantee; HTTP 429, geographical restrictions, schema changes and no match are possible.

## Reproducible checks

- GitHub Actions `native-song-recognition.yml` builds actual Rust JNI using `cargo ndk -t arm64-v8a -t armeabi-v7a ... build --release --lib`, and compiles Android code using `./gradlew :app:compileDebugKotlin --stacktrace --no-daemon`. **No APK task is invoked**. Run `43433570282` passed host Rust test/compile, both ABI builds and Kotlin compile on a prior version of this implementation.
- The original LRCLIB test workflow uses `npm ci`, `npm test -- --runInBand`, `npx tsc --noEmit`, `npm run lint -- --max-warnings 0`. It has passed with 52 tests; The latest confirmed full run `43436063594` passed **53/53 Jest tests (13 suites)**, TypeScript and ESLint, and a real LRCLIB HTTP 200 smoke test. https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/43436063594.
- Real audio test: two independent *public-domain* recordings of Beethoven Symphony No. 5 (movements I and IV) were downloaded only on CI, decoded as 12s samples and fingerprinted by the **same vendored Rust algorithm**. Shazam responded HTTP **200**, but `track=null` for both in run `43433696270`: actual HTTPS access was established, but **song identification was not confirmed**. Earlier request shape produced HTTP 429. **Verified recognition:** GitHub Actions run `43436063722` downloaded ShazamIO’s known-positive `Gloria.ogg`, decoded it to 16 kHz PCM, generated the signature through FreeTune’s vendored Rust algorithm, and sent a real HTTPS POST to Shazam. Response: **HTTP 200**, `track.title = "I Will Survive"`, `track.subtitle = "Gloria Gaynor"`; signature URI length 5,965 characters. A subsequent test tightened this to assert expected title/artist explicitly. https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/43436063722.
- Physical Android microphone, `content://` providers, file cancellation/retry, audio interruptions and UI-to-Save flow **have not been run on a phone**. A successful CI compilation does **not** establish runtime correctness. Network limits can prevent matches.

## Commands (from repo root)

```sh
npm ci
npm test -- --runInBand
npx tsc --noEmit
npm run lint -- --max-warnings 0
cargo test --manifest-path android/song-fingerprint/Cargo.toml
cd android/song-fingerprint
cargo ndk -t arm64-v8a -t armeabi-v7a -o ../app/src/main/jniLibs build --release --lib
cd ../
./gradlew :app:compileDebugKotlin --stacktrace --no-daemon
```

This phase **implements a real local fingerprint/network pipeline** and confirms positive audio identification end to end from Rust PCM fingerprint to a genuine Shazam result. It remains **partially verified for Android runtime** until microphone, document-provider audio, cancellation and UI-to-Save flow are exercised on physical Android hardware. Do not describe the 200/no-match response as a recognized song.
