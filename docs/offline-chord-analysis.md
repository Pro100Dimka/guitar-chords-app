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
no HTTP request, server, API key, microphone permission, or model download.
The note model and its inference runtime are bundled with the application. A file stored in a cloud document provider must first
be available through that provider; cloud-file acquisition is an OS operation.

The shared core combines a pinned Spotify Basic Pitch note model with an
independent chord decoder. A bounded, bandlimited resampler converts the 16 kHz
native PCM stream to the model's 22.05 kHz input. The model supplies note and
onset evidence; bass, note continuity and temporal context determine chord
labels. The decoder receives no file name, artist, expected key, chord sheet or
song-specific timing rules. FFT energy/tonality and the existing onset envelope
remain available for silence rejection, key and tempo estimates.

The decoder first estimates a root timeline, then pools supported note events
to determine each chord's quality. This allows an arpeggio to reveal its third
after the bass. The loudest bass is not automatically the root: an impossible
root interpretation can be repaired when another root has a fully supported
formula. Same-root suspensions, sevenths and added notes retain independently
supported boundaries. A short melodic ornament alone must not rename the
remaining passage. Boundary alignment is bounded and considers when the old
third stops sounding; it cannot jump back to an arbitrary earlier bass attack.
A brief, independently attacked third can remain decisive even when its mean
energy is low across a long ringing chord. Moderately strong note/onset evidence
requires longer support and temporal alignment between the attack and nearby
note activation. Independent maxima from different moments cannot be multiplied
into a false note event. This moderate evidence is used for the final formula;
root and boundary decisions retain their stronger evidence requirement. A very
short harmonic blip or the tail of an old third does not acquire the same
protection. These rules apply to every root and do not encode a particular song
or progression.

The output vocabulary is 14 qualities in all twelve roots: major, minor,
power (`5`), `sus2`, `sus4`, `6`, `m6`, `7`, `maj7`, `m7`, `dim`, `aug`, `add9`
and `madd9`. `N` remains an internal unknown/no-chord marker. The screen and
export use a localized **Undetermined / Не определён / Не визначено** label;
unknown intervals never become playable `[N]` chord tokens. `D5(9)` and `A5(9)`
can be compared with `Dsus2` and `Asus2`; ordinary user-entered `C9` retains its
dominant-ninth meaning and is not globally rewritten to `Cadd9`.

Chord names describe an automatic harmonic estimate. Inversions, omitted-note
formulas and every possible extension are not separate output labels. Vocal
melody and dense arrangements can disagree with a guitarist's accompaniment
chart. Key and tempo are estimates and may be absent or ambiguous, including
half/double tempo. Segment confidence is a heuristic, not a calibrated
probability. Display/export precision of 0.01 seconds does not imply 10 ms chord
boundary accuracy. No lyric, beat-grid or strumming-pattern transcription is
claimed.

### Embedded model and runtime

The original 230,444-byte Apache-2.0 ONNX model is pinned to Spotify commit
`fa5997af0a8210982619003269994a1be25eddf3`. The application embeds a
**196,096-byte NNEF representation** with identical weights and a pinned
`tract-nnef = 0.23.9` runtime. The larger ONNX importer is used only by the
isolated [build-time converter](../scripts/chord-model-converter/README.md).
Source and derived hashes, public tensor labels, conversion steps and licenses
are recorded in [model provenance](../android/song-fingerprint/models/basic-pitch/provenance.json).

Model windows contain 43,844 samples and advance 36,164 samples. Fifteen output
frames are cropped from either side. Frame centers use the actual absolute
window positions; the last interval ends at the original PCM duration. No
whole-song PCM is retained by the model adapter. The immutable optimized graph
is shared, while each worker has independent inference state and streaming
buffers. Model asset changes are tracked as native build inputs.
The chord decoder stores note activations in fixed blocks of 4,096 frames,
avoiding whole-recording reallocation and copying. At the 15-minute limit these
blocks occupy about 57 MiB; this is feature storage, not total process memory.
Viterbi work is linear in the 169 states per frame, and prefix note evidence
advances once rather than rescanning all preceding notes after each change.

Four real-audio model windows, including initial and final padding, were compared
with the official ONNX model using the exact production-resampled inputs.
Maximum absolute differences were 3.91e-6 for notes and 5.67e-6 for onsets; all
comparisons passed absolute/relative tolerance 1e-5. This establishes numerical
adapter parity on those inputs, not chord accuracy or phone performance. See
the [window-level evidence](offline-chord-model-validation.json) for input,
model, source and output-comparison provenance.

The model's 196 KB is not the total feature size. The inference runtime also
adds native code. An isolated stripped Linux host probe was 16.84 MB with the
NNEF loader versus 22.67 MB with the ONNX loader; compressed sizes were 5.28 and
7.07 MB. These are not APK/IPA increments. App download size and phone latency
require target builds and device measurements. Licenses and attributions are
available offline in Settings → Sound credits.

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

## Final frozen evaluation (chroma-v2)

The final candidate is `aligned-third-v2`, built from `chords.rs` SHA-256
`efbf4715aff194212948023fa06329be5a1c15d2554bcb7191388c5a4cf67d75`.
The executable SHA-256 is
`840356f71e7fdbad4c209b55c234bedc9e97c59b2ca03a0355308334b217e27a`.
Its [frozen report and unmodified predictions](offline-chord-evaluation/candidate-final/README.md)
retain both reference roles, every selected recording and every regression.
The final candidate was evaluated once on the sealed fresh twelve; it was not
changed after those results were observed.

The primary comparison is against the original `01ddfeab` production core on
all **367.9884 seconds** of the fresh twelve GuitarSet recordings. Values below
are duration weighted. "Performed" is the dataset's sheet-informed,
semi-automatic, verified note-derived annotation; it is not a guarantee of a
unique harmonic interpretation. "Instructed" is the supplied chord sheet.

| Reference and metric | Original v1 | Final v2 |
| --- | ---: | ---: |
| Instructed: exact root and formula | 70.28% | 56.26% |
| Performed: exact root and formula | 50.55% | 62.03% |
| Root only, both reference roles | 74.27% | 81.82% |
| Instructed: major/minor projection | 74.09% | 73.84% |
| Performed: major/minor projection | 80.83% | 83.13% |
| Instructed: pitch-class Jaccard similarity | 80.66% | 80.05% |
| Performed: pitch-class Jaccard similarity | 79.19% | 85.14% |

Exact/root/Jaccard denominators remain the full 367.9884 seconds. Projection
uses 362.5339 seconds for instructed and 319.0665 seconds for performed,
excluding and reporting non-triad reference material. There were no reference
X or N intervals and no reference gaps. Both engines have the same 0.000113
seconds of missing predicted endpoint time due to output rounding; that time
remains wrong. No difficult recording was removed after scoring.

This is a mixed outcome: performed-formula and root scores improve, while exact
agreement with the instructed sheet declines. Individual recordings also
regress. For example, performed exact agreement on `00_SS1-68-E_comp` falls from
87.96% to 68.45%. **These results do not establish professional transcription
quality, universal improvement, or accuracy on arbitrary full mixes.** The
feature remains an automatic editable estimate requiring review. The separate
training-overlap limitation in the quality protocol also applies.

On the original twelve recordings, now development-after-evaluation, final v2
performed exact agreement is 58.44%, versus 57.51% for the first frozen v2 and
49.96% for v1. Instructed exact is 53.17%, versus 52.24% and 65.67% respectively.
Those numbers are a regression check after the diagnosis, not a second holdout.

### Complete Behind Blue Eyes result

The final run analyzed the entire **276.456813-second** alternative-video
recording. The first five determined labels match the supplied intro, with the
reference-specific aliases documented in the quality protocol:

| Predicted interval, seconds | Final prediction | Supplied notation |
| --- | --- | --- |
| 0.288–2.464 | Em | Em |
| 2.464–4.576 | G6 | G6 |
| 4.576–8.480 | Dsus2 | D5(9) |
| 8.480–12.448 | Cadd9 | C9 in this particular chart |
| 12.448–15.968 | Asus2 | A5(9) |

The leading 0.288 seconds remain undetermined. These are predicted boundaries,
not manually timestamped reference truth. The complete **109-segment** output
is available as [readable text](offline-chord-evaluation/candidate-final/behind-blue-eyes/behind-blue-eyes-detected-chords.txt)
and [unchanged JSON](offline-chord-evaluation/candidate-final/behind-blue-eyes/output.json).
No chord label was corrected by hand before saving those outputs.

The rest of the song still contains quality errors and missed changes. Against
the untimed printed chart, exact formula event edits are 69, compared with 73
for v1 and 66 for the first v2. The two-cycle instrumental hypothesis gives
69, 74 and 66 respectively. Root-only edits improve from v1's 24/21 to 4/1 for
both v2 candidates. Thus the final third fix preserves the intro and root order
but slightly worsens whole-sequence exact formula edits relative to the first
v2. Both structures are [reported](offline-chord-evaluation/candidate-final/behind-blue-eyes/sequence-comparison.json);
neither is selected to obtain a better number. None of these event counts is a
whole-song accuracy percentage. The estimated key and tempo are not validated.

The final BBE core run took **18.614 seconds**, starting from decoded PCM
(18.632 seconds including process startup). The fresh twelve took 25.297 seconds
of summed CLI time and 25.647 seconds of process wall time. These are Linux CPU
host measurements, not phone timings. A separate maximum-duration run of the
earlier frozen v2 candidate observed 86,968 KiB peak RSS on 900 seconds of PCM;
its [full evidence](offline-chord-evaluation/candidate-1/README.md) is labeled
with that earlier binary and must not be presented as a final-phone measurement.

## Baseline measurements (chroma-v1)

These retained measurements describe commit
`01ddfeab9ba5aa0c8a794f4a1a84f617260a3a1b`, before the note-model upgrade.
They were measured on a Linux x86_64 host using that commit's production Rust
core. Timing starts with already decoded 16 kHz PCM and excludes
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

### Previous Behind Blue Eyes correction

The initial Apple preview was not the start of the song: waveform correlation
places it at **45.03675 seconds** in the complete video recording. Its initial A
therefore could not validate the opening chord. Running the complete recording
then exposed a separate real error: the original core labeled the opening as E
instead of Em. A short arpeggio context and accumulated fifth-harmonic energy
favored a major-third estimate over the later minor-third note.

The v1 baseline reports Em at **0.288–2.592**, **16.416–18.912**, and
**32.480–34.720 seconds**. The leading 0.288 seconds remain N. These are targeted
passage checks, not a verified transcription of the whole song. The
[publisher's intro reference](https://dux-verlag.de/ancora_myfactory/CustomUpload/374O357O340O370O356O369O350O352O365O354O366O369O352O/D%20873_01.%20Behind%20Blue%20Eyes.pdf)
contains Em, G6, Dsus2, Cadd9 and Asus2. The v1 major/minor vocabulary could not
represent all those qualities: the Asus2 region still receives Am/A estimates,
including Am at 12.384–13.984 seconds. Root/fifth dyads could also acquire a
major estimate without a separately played third.

[Case evidence](offline-chord-behind-blue-eyes-validation.json) records the public
input URL/hash, recording version, preview alignment, unmodified before/after
opening output, reference and remaining limits. The complete v1 output is
in the validation JSON above. The accompanying GuitarSet score improved from
93.99% to 96.51%; that does not imply the same improvement on arbitrary songs.

## Evaluation policy

The [quality protocol](offline-chord-quality-protocol.md) defines exact formula,
root-only and separately denominated major/minor metrics. It distinguishes
GuitarSet's instructed and performed annotations, preserves the user's untimed
reference, and explains the limits of both twelve-recording cohorts. The first
cohort informed the third-preservation fix after its initial blind evaluation
and is now development material. A separately sealed fresh cohort is the final
candidate's one-shot holdout from decoder development; overlap with Basic
Pitch's training set is unverified. No full-song accuracy percentage is inferred
from an untimed chord chart.
One intermediate candidate was rejected on the already-known intro before the
fresh holdout was opened. Its [unchanged output and rejection record](offline-chord-evaluation/development-gates/third-consistency-v2/README.md)
are retained: it incorrectly combined unrelated note/onset maxima and weakened
initial boundary evidence. The final fix separates those decisions and pairs
note evidence in time.

### Section analysis, rhythm and tablature

The current output is a timed chord timeline. It does not yet classify strumming
versus arpeggiation, generate a strum pattern, or output tablature. Section-based
validation can use the full-context prediction and inspect a selected interval;
re-running a hard-cut excerpt is a different experiment because the cut can
remove the preceding bass attack or a delayed chord note. Any future excerpt
mode should retain surrounding context and report only the requested interval.
The [section-inspection command](offline-chord-section-inspection.md) already
provides that validation view from a saved full-recording prediction. It retains
absolute times, marks clipped display boundaries and reports gaps. Optional
timed JAMS references produce separately denominated metrics for that interval;
without a timed reference it reports predictions only. It is developer tooling,
not an in-app selection or playback interface.

The existing note/onset estimates are a useful input for later rhythm and note
transcription, but they are not validated guitar-part separation. A playable
tab also requires durations, tuning and string/fret assignment. Different
fingerings can produce the same pitches, so a generated fingering should be
identified as a proposed arrangement rather than the original player's exact
fingering. This extension needs separate annotated tests and is not implied by
the chord-quality results.

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

The final source passed **31 Rust release tests**, with no profile overrides.
These include all 24 major/minor triads, 48 delayed-third plucked arpeggios,
144 wide/inverted triads, 168 quality/root combinations and 60 short quality
events over continuously ringing bass and fifth. Seventeen note-activation
scenarios isolate boundary preservation, extensions, passing notes and delayed
arpeggio completion. A further 36 cases cover short strong thirds, moderate
joint note/onset evidence and sub-60 ms harmonic blips in all twelve roots.
Forty-eight aligned/misaligned onset controls and twelve inherited-fourth
arpeggio controls reproduce the two later regressions; both new test functions
fail the rejected intermediate implementation and pass the final source.
The optimized Viterbi path is checked against exhaustive
transitions, including ties. Detuning, silence, noise, single notes, chunk
invariance, exact timeline coverage, limits, FFI lifecycle, concurrent model
workers and the existing fingerprint checks remain covered. Synthetic controls
are regression checks, not estimates of accuracy on music recordings.

Service/UI tests cover both engine versions, strict label validation, localized
unknown intervals, editor/save/transposition compatibility, cancellation and
offline license display. TypeScript and the affected ESLint checks pass.
Seven evaluator semantic checks and five section-inspection tests verify exact
formula/root distinctions, denominator handling, clipping, gaps and invalid
input rejection independently of model inference.
The production Kotlin module compiles with Android/RN signature stubs;
lifecycle tests include deliberately blocked providers, prompt cancellation,
bounded workers, late cleanup and retry. Stub checks are not a substitute for
real Android codec execution.

The native CI workflow also runs the Swift test on macOS with actual stereo WAV
and AAC decoding, links the real Rust library, and checks cancellation/retry.
The native Android job compiles Kotlin and all three Rust JNI architectures;
the separate iOS application workflow builds the complete simulator application.
The Swift decoding test also checks the `chroma-v2` engine identifier, guarding
against accidentally linking a stale library.
Physical-device latency, memory use, and the final store download-size delta
still require release builds and measurements on the target phones. Source/binary sizes are not an APK/IPA size measurement. The new bundled model
and runtime are described above.
The evaluation inputs were decoded/resampled with FFmpeg. The existing native
OS-to-16 kHz converters use streaming sample averaging, so the core scores do
not establish end-to-end accuracy for every native import sample rate or codec.
Real-device imports remain a separate validation step.
