# Offline chords from an audio file

Library → Add → **Chords from audio** (Russian: **Аккорды из аудио**). The same
action is available on the idle recognition screen. Choose an audio file, review
the timed chord chart, then open it in the existing song editor to edit and save.
The file name becomes the editable title; the artist stays blank. No lyrics are
invented. Automatic analysis is clearly identified in the screen and chart.

## What runs on the phone

Android MediaExtractor/MediaCodec and iOS AVAudioFile decode the selected local
file in bounded chunks. A background worker downmixes/resamples to 16 kHz mono
and feeds the shared Rust core already built into the app for fingerprinting.
Only the resulting timeline crosses the React Native bridge. This feature has
no HTTP request, server, API key, microphone permission, neural model download,
or new package dependency. A file stored in a cloud document provider must first
be available through that provider; cloud-file acquisition is an OS operation.

The core uses Hann-windowed FFTs, interpolated spectral peaks, harmonic
discounting, chroma templates, and temporal smoothing. It returns the 24 major
and minor triads, or `N` when no usable harmony is detected. The analysis is a
practical estimate, not a transcription of every played note. Sevenths,
suspended/diminished chords and inversions are not separate output labels.
Key and tempo are estimates and may be absent or ambiguous (including half/double
tempo). Segment confidence is a matching heuristic, not a calibrated probability.

The 512 ms spectral window advances every 64 ms. Chroma averaging uses a 512 ms
radius to retain notes played at different times in an arpeggio. Fifth-harmonic
energy receives a stronger discount because it can imitate a major third;
octave/fifth harmonic evidence retains its existing weight. Displayed/exported
times use hundredths of a second. This display precision does not imply 10 ms
recognition accuracy. Adjacent estimates form a continuous full-duration timeline.
No beat grid, strumming pattern, lyrics alignment, or audio playback synchronization
is claimed by this implementation.

## Lifecycle and limits

- One logical analysis at a time; selectable local `file://` / Android `content://` URIs only.
- Audio duration from 1 second through 15 minutes. Longer files fail explicitly;
  they are never silently truncated to a short sample.
- Streaming decode and bounded PCM buffers; no full song PCM allocation in JS.
- Cancellation and navigation away detach the request. Late provider results
  cannot replace a newer result. Decoder/core cleanup remains owned by its worker.
- At most two native provider workers, bounded queue/admission, and a 180-second
  timeout prevent unbounded growth when a provider does not honor cancellation.
- The original file is never deleted or rewritten. Unsupported/corrupt formats
  produce a localized error. Actual format support comes from the OS decoder.
- An oversized chart is not truncated when opening the editor; the app reports
  that the existing editor content limit would be exceeded.

## Real-audio measurements

Measured on a Linux x86_64 development host using the **same Rust core as the
mobile bridges**. Timing starts with already decoded 16 kHz PCM and excludes
audio decoding, file acquisition, the bridge, and UI. These are **not phone
benchmarks**. See [validation JSON](offline-chord-analysis-validation.json) for
the output timeline and machine-readable reports, and
[fixture provenance](offline-chord-analysis-fixtures.json) for URLs, hashes,
CC-BY credits, and reproduction commands.

| Recording | Duration | Measured result | Core time on this host |
| --- | ---: | --- | ---: |
| GuitarSet `00_SS3-98-C_comp`, live acoustic performance of the Canon progression | 39.18 s | 96.51% duration-weighted major/minor agreement; key C correct; 96.91 BPM versus reference 98 | 0.049 s |
| Gloria Gaynor — I Will Survive, existing pinned recognition test recording | 198.27 s | Full-file analysis, 108 segments; estimated Am / 116.44 BPM | 0.372 s |
| Limp Bizkit — Behind Blue Eyes, complete alternative music-video audio | 276.46 s | Full-file analysis, 102 segments; opening Em and two repeated Em passages checked; no whole-song accuracy score | 0.446 s |

The main **96.51%** score counts the entire reference duration, including chord
boundaries and unknown intervals. A separately reported score excluding 250 ms
at each reference boundary is 99.92%; it is not substituted for the main score.
One annotated acoustic performance does not establish accuracy across other
styles, songs, recordings, or full mixes. There is no trusted chord reference for
the entire commercial recordings here, so their whole-song chord accuracy is
**not measured**. Their audio is not added to the repository or the application.

### Behind Blue Eyes correction

The initial Apple preview was not the start of the song: waveform correlation
places it at **45.03675 seconds** in the complete video recording. Its initial A
therefore could not validate the opening chord. Running the complete recording
then exposed a separate real error: the original core labeled the opening as E
instead of Em. A short arpeggio context and accumulated fifth-harmonic energy
favored a major-third estimate over the later minor-third note.

The current core reports Em at **0.288–2.592**, **16.416–18.912**, and
**32.480–34.720 seconds**. The leading 0.288 seconds remain N. These are targeted
passage checks, not a verified transcription of the whole song. The
[publisher's intro reference](https://dux-verlag.de/ancora_myfactory/CustomUpload/374O357O340O370O356O369O350O352O365O354O366O369O352O/D%20873_01.%20Behind%20Blue%20Eyes.pdf)
contains Em, G6, Dsus2, Cadd9 and Asus2. The current major/minor vocabulary cannot
represent all those qualities: the Asus2 region still receives Am/A estimates,
including Am at 12.384–13.984 seconds. Root/fifth dyads can also acquire a major
estimate without a separately played third.

[Case evidence](offline-chord-behind-blue-eyes-validation.json) records the public
input URL/hash, recording version, preview alignment, unmodified before/after
opening output, reference and remaining limits. The complete current output is
in the validation JSON above. The accompanying GuitarSet score improved from
93.99% to 96.51%; that does not imply the same improvement on arbitrary songs.

## Verification and reproduction

```sh
cargo test --locked --release --lib --manifest-path android/song-fingerprint/Cargo.toml
cargo check --locked --lib --target aarch64-linux-android --manifest-path android/song-fingerprint/Cargo.toml
npm test -- --runInBand __tests__/offline-chords.test.tsx __tests__/library.test.tsx __tests__/recognition.test.tsx __tests__/recognition-arrangement-save.test.tsx __tests__/editing.test.tsx
npx tsc --noEmit
python3 scripts/check-offline-chord-native.py --kotlin-lib /path/to/kotlin/lib
# macOS / Apple SDK:
python3 test-ios-offline-chords.py
```

The focused JS run passed 208 tests, including 20 new service/UI cases. The Rust
library run passed 13 tests, covering all 24 triads, slight detuning, silence,
noise, single notes, chunk invariance, timeline boundaries, tempo pulses, limits,
FFI lifecycle, and the existing fingerprint checks. Two regression tests add
48 delayed-third plucked-arpeggio cases and 144 wide/inverted-voicing cases across
all roots and both qualities. The arpeggio regression fails on the original
implementation. The Android-target Rust
bridge type-checks. The production Kotlin module compiles with Android/RN
signature stubs; lifecycle tests include deliberately blocked providers, prompt
cancellation, bounded workers, late cleanup and retry. Stub checks are not a
substitute for real Android codec execution.

The native CI workflow also runs the Swift test on macOS with actual stereo WAV
and AAC decoding, links the real Rust library, and checks cancellation/retry.
The separate Android and iOS application build workflows verify app integration.
Physical-device latency, memory use, and the final store download-size delta
still require release builds and measurements on the target phones. No new model
or runtime is bundled, but source/binary sizes are not an APK/IPA size measurement.
