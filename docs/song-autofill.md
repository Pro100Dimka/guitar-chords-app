# FreeTune song autofill: Android native recognition

Branch: `feature/song-autofill`. Android phone APKs with versionCode 10 were built on 2026-11-14 and include the recognition-lyrics and chord-provider fallback fixes described below, plus the updated guide and prepared string/fingering playback. Earlier source-only notes record the state before this build. No new Android App Bundle is claimed.

## Current implementation

- **On device**: Android AudioRecord captures up to 20 seconds, checking 3, 7, 12 and 20-second checkpoints with fingerprints of at most 12 seconds, or MediaExtractor/MediaCodec reads a bounded 12-second section of an audio document via `content://` / `file://`. Decode runs on a dedicated executor, not the React Native UI thread. Input is converted to 16kHz mono PCM16 with bounded averaging/resampling. File selection reads the original provider URI directly; original audio is not changed or deleted.
- **Fingerprint**: JNI links a Rust library built with `cargo ndk` for `arm64-v8a` and `armeabi-v7a`. The source of the signal-processing and signature encoder is shazamio-core 2.1.0 pinned to `63f9583ee9729c95b9e9f10af6f2006d13df6fb2`, adapted for a direct PCM entrypoint without PyO3/Python.
- **Network**: Shazam's *unofficial* `amp.shazam.com/discovery/v5/en-US/GB/iphone/-/tag` HTTPS request sends a base64 signature and timing metadata, not raw recording audio. 10/15-second connection/read timeouts and per-429 `Retry-After` cooldown apply. No API token, server, Python, model or Oracle deployment is needed.
- **UI**: Library Add opens a choice of manual entry, microphone recognition, audio-file recognition and TXT/ChordPro import. Recognition has its own screen. A microphone match becomes a whole-card result; selecting it opens a draft with metadata, artwork and available lyrics/chords. File flows open the prepared draft after processing. The user reviews and saves it. Existing song data is not overwritten by a late or cancelled request. The form includes a full-screen monospace editor. Source attribution is retained as metadata and a link icon, without a source-label block.
- **Lifecycle**: cancellation stops the microphone and disconnects the HTTP request. Audio is retained in a bounded memory buffer and not saved as a temporary file. There are no feature-created audio files to clean after crashes. The original file is never deleted. Late completion is guarded by request generations and form snapshots.
- Android-only UI actions are hidden on other platforms. Locales: English, Ukrainian, Russian.

## Source / license audit

- `shazamio-core` **2.1.0** is MIT; versions **up to and including 2.0.0** contained SongRec GPL-3.0+ code. Only the 2.1 source was adapted; original MIT text is in `android/song-fingerprint/UPSTREAM-LICENSE`. https://github.com/shazamio/shazamio-core
- `Audile` is GPL-3.0+; none of its implementation was copied. https://github.com/AudileTeam/Audile
- Rust JNI dependency `jni 0.21.1` is MIT/Apache-2.0; `chfft 0.3.4` is MPL-2.0. The unmodified `chfft` source is available at https://crates.io/crates/chfft/0.3.4; license text is in `CHFFT-MPL-2.0`. Binary redistribution must retain notices and MPL source availability. Also check resolved Cargo.lock transitive license inventory before a store release.
- LRCLIB and lyrics.ovh supply lyrics only. Пісенник supplies complete arrangements with inline chord markers. Source links are retained in song preferences and library backups. Site access does not establish permission for redistribution; review publisher permissions before store release.
- Shazam is an unofficial endpoint with no contractual availability guarantee; HTTP 429, geographical restrictions, schema changes and no match are possible.

## Reproducible checks

- GitHub Actions `native-song-recognition.yml` builds actual Rust JNI using `cargo ndk -t arm64-v8a -t armeabi-v7a ... build --release --lib`, and compiles Android code using `./gradlew :app:compileDebugKotlin --stacktrace --no-daemon`. **No APK task is invoked**. Run `43433570282` passed host Rust test/compile, both ABI builds and Kotlin compile on a prior version of this implementation.
- The original LRCLIB test workflow uses `npm ci`, `npm test -- --runInBand`, `npx tsc --noEmit`, `npm run lint -- --max-warnings 0`. It has passed with 52 tests; The latest confirmed full run `43436430153` passed **53/53 Jest tests (13 suites)**, TypeScript and ESLint, and a real LRCLIB HTTP 200 smoke test. https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/43436430153.
- Real audio test: two independent *public-domain* recordings of Beethoven Symphony No. 5 (movements I and IV) were downloaded only on CI, decoded as 12s samples and fingerprinted by the **same vendored Rust algorithm**. Shazam responded HTTP **200**, but `track=null` for both in run `43433696270`: actual HTTPS access was established, but **song identification was not confirmed**. Earlier request shape produced HTTP 429. **Verified recognition:** GitHub Actions run `43436063722` downloaded ShazamIO’s known-positive `Gloria.ogg`, decoded it to 16 kHz PCM, generated the signature through FreeTune’s vendored Rust algorithm, and sent a real HTTPS POST to Shazam. Response: **HTTP 200**, `track.title = "I Will Survive"`, `track.subtitle = "Gloria Gaynor"`; signature URI length 5,965 characters. A subsequent **passing** test `43436381560` explicitly asserted title `I Will Survive` and artist `Gloria Gaynor` against a live Shazam reply (HTTP 200): https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/43436381560. https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/43436063722.
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

## Delivery verification snapshot

- Native compilation `43433570282`: Rust host build/test, Android arm64 and armeabi-v7a JNI build, Android Kotlin compile all **passed**, without APK. Native code later received resampling/cooldown refinements; device tests remain outstanding.
- Live native signature recognition `43436381560`: **passed, HTTP 200, Gloria Gaynor — I Will Survive** from genuine audio, expected result asserted.
- React Native Jest/TypeScript/ESLint `43436430153`: **passed 53 tests (13 suites), TypeScript and ESLint**.
- Physical phone runtime including `content://` and microphone recording has not been tested. No claim of Android runtime certification.


## Content lookup

- `lookupSongContent` checks Cifra Club, E-Chords, Cifras, GuitareTab, Пісенник and LRCLIB concurrently, returning the first matching chord arrangement. Individual provider errors do not block another successful source. It never joins another source's lyrics to those chords.
- Пісенник HTML is parsed as data with htmlparser2. Scripts are not executed. Search and detail requests are separated by the site's 10-second crawl delay. Only matching public song pages are followed.
- If these sources return no usable content, the public lyrics.ovh API is queried for the exact artist and title. Provider errors do not discard recognized metadata.
- «Ліхтарі» / O.Torvald was manually retrieved from Пісенник: 1,318 characters, 88 chord markers, 55 lines. lyrics.ovh returned HTTP 200 for «Broken» / Seether. These are live checks, not an availability guarantee.
- The source name and HTTPS URL survive save, editing and library backup. The form exposes a source link. No remote song catalog or lyric content is bundled with the application.
- Privacy text lists the external services receiving song title, artist, fingerprint or artwork requests.


## Early recognition and foreign arrangements

- Microphone capture continues while the recognition request runs. The first attempt starts after 3 seconds; later windows are tried only when no match was returned. A successful match stops capture. The unofficial service and network do not guarantee one-second recognition.
- Cifra Club, E-Chords and Cifras public canonical song pages provide additional arrangement sources for Latin-script titles/artists. The title and artist from structured data or matching page headings must match before importing the chord chart. Remaster and explicit featured-artist suffixes are normalized. Some providers returned HTTP 403 during the current desktop check, so availability on Android remains unconfirmed. No login, internal API, paywall or access-control bypass is used. Catalog coverage and publisher permissions remain separate release checks.
- Imported inline chord markers are converted to chord rows above the lyrics. Existing saved songs are displayed and edited in the same format without a destructive migration. Non-chord labels in brackets are preserved. The lyrics editor uses a monospace font for alignment.

## Source review, 2026-11-14

- Apostrophes are removed when forming canonical chord-page slugs, so titles such as `Don't Look Back in Anger` use the published `dont-look-back-in-anger` path.
- LRCLIB retries a title-only search when the initial result list contains no verified artist/title match, including when that list was nonempty.
- A cancelled, unsent Пісенник request does not consume the crawl-delay interval. Requests that actually start still remain at least ten seconds apart.
- A blocked provider does not turn a healthy no-match answer from another provider into an outage message. A total outage and explicit cancellation still report errors. Inapplicable Latin-script chord sources are omitted for other scripts.
- A song title and artist must belong to one matching music metadata entry, or matching page headings. Unrelated metadata nodes cannot be combined into a fabricated match.
- Regression checks first reproduced six failures before the fixes. The expanded content module passes 13 checks. Fixture lyrics are original test text.
- Live execution of the current TypeScript lookup retrieved arrangements for Gloria Gaynor and Seether from Cifra Club. With Cifra Club deliberately replaced by a simulated 503, genuine Пісенник requests retrieved the Gloria Gaynor arrangement in about 10.6 seconds. The apostrophe-title Oasis lookup returned a Cifra Club arrangement through the corrected canonical URL. No lyric text is copied into this documentation.
- E-Chords and Cifras returned actual Cloudflare 403 challenge pages from this network. The implementation does not bypass those challenges. Their mobile availability is not established by fixture checks.
- These live checks execute the source lookup on Node, not a new device build. Physical-device verification remains separate.

## Recognition lyrics fallback, 2026-11-14

- Reproduced the reported lookup for Jimmy / Friday May 14: LRCLIB returned HTTP 200 with no records for both exact identity and title search; Cifra Club and lyrics.ovh returned 404; E-Chords and Cifras returned 403; Pisennyk returned no match. This does not prove that no arrangement exists anywhere.
- A control lookup for Seether / Broken through the same source code returned an arrangement with chords from Cifra Club. Node networking checks are not physical-phone networking checks.
- The Android bridge previously discarded a recognition response's optional LYRICS section. It now forwards bounded text, source credit and a canonical Shazam track URL. The form uses that text when external lookup produces no usable content. Available external arrangements remain preferred, and manually entered content is preserved.
- The actual response for the reported Jimmy recording is unavailable, so lyrics availability in that response and successful autofill of this specific track are not confirmed. No chords are invented or inferred from metadata.
- Current source verification: 80 tests in 13 suites, TypeScript, changed-source ESLint and Android compileReleaseKotlin passed. No replacement APK has been built for this fallback.
- Response schema reference: https://github.com/shazamio/ShazamIO/blob/master/shazamio/schemas/models.py (optional LyricsSection with text lines and footer).

## Chord-provider failover correction, 2026-11-14

- Cifra Club uses the canonical artist path `the-eagles` for Eagles. Hotel California now returns its verified arrangement through the normal lookup.
- GuitareTab is an additional chord source. The public search form locates a chord chart with matching title and performer in the same result row. Only same-origin numeric chart paths are followed; structured chart metadata is checked again before import. HTML row boundaries remain separate, preserving chords above lyrics. Source attribution survives preferences and library backups.
- HTTP 403 responses pause requests to that origin for five minutes; HTTP 429 uses numeric Retry-After (bounded to one hour) or a 30-second default. Other providers continue. E-Chords and Cifras still return Cloudflare challenges on this network; this change does not bypass them or guarantee their availability.
- Live checks against current source from Windows Node: Hotel California returned Cifra Club in 0.32 seconds. With only Cifra Club deliberately replaced by HTTP 503, Broken, Wonderwall, Hotel California and Someone Like You returned real GuitareTab arrangements in 0.30 to 0.62 seconds; Nothing Else Matters returned a real Pisennyk arrangement after its crawl delay (18.6 seconds). These timings exclude audio recognition and do not measure an Android phone.
- No lyric or chord-chart text is bundled or copied into this documentation. Public availability does not grant redistribution rights. This source fix is not included in the previously built versionCode 8 APKs.
