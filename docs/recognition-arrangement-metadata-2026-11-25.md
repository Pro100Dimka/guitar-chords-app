# Recognized-song tempo and accompaniment — 25 November 2026

## Completed result

The fresh complete-corpus lookup returned **lyrics with chords for all 100 unchanged song identities**, with zero misses and zero status regressions from the previous verified 100-song run. The stricter lyric guard remained enabled. Source-declared strumming was imported for **11 songs**; this live run imported **no source tempo or picking pattern**. Those availability limits are separate from the 100/100 lyrics-and-chords result and are detailed below.

The published application source is [`7a3b0cedabe18502fe38cc1fd444d18c1cf7a5ff`](https://github.com/Pro100Dimka/guitar-chords-app/commit/7a3b0cedabe18502fe38cc1fd444d18c1cf7a5ff), tree `a0ee2abaf9885492eae26ec26bad4ddde9d8b7f7`, on [PR #13](https://github.com/Pro100Dimka/guitar-chords-app/pull/13). Source CI passed 1,370 Jest tests across 49 suites, TypeScript, ESLint, actual SQLite integration, native checks, the iOS simulator application build and the separate real-audio checks.

The exact outcome is preserved in the [new JSONL](recognition-arrangement-results-100-2026-11-25.jsonl), [summary](recognition-arrangement-results-100-2026-11-25.summary.json) and [investigation record](recognition-arrangement-investigation-2026-11-25.json). The previous [100-song content-coverage report](recognition-chord-coverage-100-2026-11-25.md) remains unchanged; its successful source checkpoint predates this metadata change, while the new complete run verifies continued content coverage on the updated source.

## Observed loss before editing

The investigation found two distinct transfer gaps. Some chart-provider paths returned accompaniment metadata, but Musicaccord.ru and four of the five newer fallback adapters did not call the arrangement parser. No chart option carried a source-specific tempo. The recognition screen copied only the separately recognized or looked-up tempo, and choosing another chart replaced its lyrics/rhythm without updating tempo. Adding chart tempo at the first selection alone would therefore leave stale settings when a later version omitted it. See the [previous provider implementation](https://github.com/Pro100Dimka/guitar-chords-app/blob/37df256db53384fdc88362d71beab4b0e82da175/src/components/song-autofill/lyrics.ts) and [previous recognition screen](https://github.com/Pro100Dimka/guitar-chords-app/blob/37df256db53384fdc88362d71beab4b0e82da175/src/screens/recognize-song/index.tsx).

Before the screen was changed, the new [recognition-to-save regression suite](../__tests__/recognition-arrangement-save.test.tsx) reproduced five failures:

| Reproduced case | Required result | Result before the correction |
| --- | --- | --- |
| Chart specifies 92 BPM; recognition supplies 144 | 92 | 144 |
| Chart specifies 92 BPM; independent tempo lookup supplies 144 | 92 | 144 |
| Change to a chart specifying 118 BPM; independent fallback is 137 | 118 | 137 |
| Native tempo is `NaN`; independent lookup would supply 136 | 136 | `NaN`, with independent lookup skipped |
| Native tempo is 201; independent lookup would supply 136 | 136 | 201, with independent lookup skipped |

The local snapshots are `/tmp/freetune-arrangement-test-red.json` and `/tmp/freetune-arrangement-test-green.json`: five failing and three passing cases before the screen correction, then all eight passing afterward. Their counts, failure names and hashes are preserved in the [investigation record](recognition-arrangement-investigation-2026-11-25.json). These are development snapshots, not full-corpus or physical-device results. The committed regression suite and successful source CI provide reproducible evidence. A targeted Musicaccord provider fixture also failed before metadata integration; the corresponding provider/parser follow-up passed 71 executed tests.

## Shared, scoped source metadata

All chord-provider paths now use the same [source metadata helper](../src/components/song-autofill/source-metadata.ts). It reads the verified arrangement text and, where already supported by that provider, its dedicated song-metadata block. It does not read arbitrary page text, playback controls, font size or scrolling speed to invent musical settings. The content and source attribution remain intact. [The main adapters](../src/components/song-autofill/lyrics.ts) and the dedicated [Chords & Tabs](../src/components/song-autofill/chords-and-tabs.ts), [Sonidos](../src/components/song-autofill/sonidos.ts), [WeingGuitar](../src/components/song-autofill/weing-guitar.ts), [Akkords.fun](../src/components/song-autofill/akkords-fun.ts) and [LalaTracker](../src/components/song-autofill/lalatracker.ts) adapters attach the returned metadata to their own chart option.

### Tempo

The helper accepts a single consistent, explicit tempo declaration between **40 and 200 BPM**, rounds a valid decimal value and leaves the field unset otherwise. Supported declarations include `Tempo: 92`, `Темп: 120 уд/мин`, `BPM: 108`, `128 bpm`, `Andamento: 118`, `♩ = 84`, a label followed by its value on the next line, and supported ChordPro/bracket wrappers. A number appearing in ordinary lyrics is not a tempo instruction. [Parser tests](../__tests__/song-source-metadata.test.ts) cover these forms and their boundaries.

Ranges, approximations, unsupported units, invalid values and conflicting declarations are rejected. Different tempo declarations for different sections do not become an invented single tempo or tempo map. Tempo and accompaniment are independent: conflicting tempo does not erase an otherwise valid published strumming instruction.

### Strumming, picking and meter

The [rhythm parser](../src/screens/song/rhythms.ts) recognizes explicit labels and supported preset names or notation. The changes preserve literal picking strings and require enough evidence to choose an unambiguous timing pattern. [The rhythm regression suite](../__tests__/song-source-rhythm.test.ts) includes every existing preset, numeric bass strings, rests, annotations, conflicting instructions and section-specific settings.

| Published instruction | Imported behavior |
| --- | --- |
| `Бой: шестёрка` or a matching explicit stroke grid | Use the existing matching strum pattern and its timing. |
| `Перебор: 6-3-2-3-1-3-2-3` | Preserve the literal sixth string as `63231323`; do not replace it with the chord-dependent `B` bass symbol. |
| `Перебор: 6-3-2-1-` | Preserve the explicit rest positions in `6-3-2-1-`. |
| `Перебор: 6-3-2-1-2-3` without a meter | Leave accompaniment unset because the same six notes can match 3/4 or 6/8. |
| The same six-note list annotated `(6/8)` or `(3/4)` | Preserve the literal strings and use the explicitly stated compatible meter. |
| A conflicting preset annotation, unsupported sequence or unspecified mute positions | Leave accompaniment unset instead of choosing an arbitrary interpretation. |

Global instructions remain global. Recognized section headings can carry their own accompaniment, including a strummed verse and a picked chorus. Repeated sections receive a shared setting only when all occurrences agree; a conflict does not overwrite another section's valid setting. This does not infer a pattern from the recording or claim that a supported preset is the song's uniquely correct performance.

## Selection and actual save behavior

The [recognition screen](../src/screens/recognize-song/index.tsx) keeps an external tempo fallback separately for the current attempt and uses the same rule on first selection and every subsequent version change:

```ts
selectedChart.tempo ?? preservedExternalTempo
```

The external fallback is either a valid recognized tempo or the existing independent, identity-checked tempo lookup. It passes through the existing [draft validation helper](../src/components/song-autofill/draft.ts). Invalid native values no longer bypass that validation or suppress the independent lookup. Starting another recognition clears the previous fallback. A chart without tempo restores the preserved fallback, or clears draft tempo when none exists. Accompaniment is replaced with the chosen version's own global and section settings; missing instructions clear the previous chart's accompaniment.

The new integration suite opens the real recognition screen, selects a chart, opens the real creation editor and presses **SaveSong**. Native recognition, content lookup and SQL I/O are fixture-driven; the screen, editor, preference normalization and [save handler](../src/screens/create-song-chords/formik/on-sabmit.tsx) are real. The suite checks both the serialized preference JSON sent to SQL and the live preferences store. Assertions cover global picking, verse strumming, chorus 6/8 picking, tempo precedence, switching versions, clearing metadata, invalid native tempo and a fresh attempt. The save handler already persisted these fields correctly and required no modification.

The focused eight cases and the existing recognition, manual-draft and editing suites passed **157 tests across four suites** after the screen correction. Existing cancellation/generation guards and manual-content protection remain in place. These are component/save-path regressions; the separate actual-SQLite suite covers database transactions and persistence behavior.

## Playing instructions cannot count as song lyrics

Importing accompaniment metadata must not turn a chord-only page into a successful lyrics-and-chords result. The [strict content validator](../src/screens/song/chords.ts) now excludes explicit tempo and playing instructions as lyric evidence, including split label/value lines and known instruction wrappers. An unrecognized instruction such as `Бой: неизвестный рисунок` still cannot supply the missing song lyrics merely because its pattern is unsupported.

[Positive and negative regression cases](../__tests__/chord-layout.test.ts) check that chords plus metadata alone fail strict lyric validation, the same content with actual lyric text passes, ordinary lyric sentences containing words such as “tempo” or “strumming” remain valid, and displayed instructions survive transposition. The ordinary chord-only parser remains usable for instrumental progressions. Because the strict lyric criterion changed, the same complete corpus was rerun against the updated source; its verified outcome follows below.

## Completed source CI

The following checks completed successfully on source `7a3b0ce`; their job logs were inspected. The pre-publication local run independently passed the same 1,370 tests, type/lint checks and actual SQLite integration.

| Check | Inspected evidence | Result |
| --- | --- | --- |
| Validation | [Run 45566259196, job 139041683141](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45566259196/job/139041683141) | 1,370 Jest tests in 49 suites; TypeScript, ESLint and actual SQLite integration passed. |
| Native implementation | [Android job 139041683290](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45566259239/job/139041683290) and [Swift job 139041683020](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45566259239/job/139041683020) | Android Kotlin and all three Rust JNI architectures compiled (`BUILD SUCCESSFUL`, no APK); Swift native checks passed. |
| iOS application | [Run 45566259379, job 139041683207](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45566259379/job/139041683207) | Simulator application reported `BUILD SUCCEEDED`, with both extensions embedded. The unsigned iPhone Release step was skipped. |
| Separate real-audio check | [Run 45566259285, job 139041682853](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45566259285/job/139041682853) | HTTP 200 and identification of Gloria Gaynor — I Will Survive. Both optional Beethoven probes returned HTTP 200 with `track: null`. This confirms one positive audio example, not 100 recordings. |

## Fresh full-corpus verification

The [complete audit, run 45566259163 / job 139041683080](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45566259163/job/139041683080), returned **100/100 lyrics-and-chords results, zero lyrics-only results and zero misses**. Every identity and its ordering matches the unchanged [100-song manifest](recognition-chord-corpus-validated-100-2026-11-25.json), SHA-256 `3bc61bf3c8fa9ff31eb467244ad17008a4f2f412cc072e95811b0c23f9911a82`. No failed identity was replaced. Comparison with the preceding complete audit found zero status regressions.

The [runner](../scripts/check-chord-corpus.cjs) records each returned chart option's `tempo` and `rhythm`, alongside identity, strict lyrics-and-chords flags, URL, timings and hashes. The following metadata counts mean at least one returned option independently passes the identity and strict content checks and contains the specified instruction. They are availability counts for these accepted source charts, not a musical-correctness score.

| Repertoire cohort | Lyrics + chords | Imported source tempo | Imported strumming | Imported picking |
| --- | --- | --- | --- | --- |
| Ukrainian repertoire | 30/30 | 0 | 1 | 0 |
| Russian repertoire | 30/30 | 0 | 10 | 0 |
| English repertoire | 30/30 | 0 | 0 | 0 |
| Other repertoire | 10/10 | 0 | 0 | 0 |
| **Total** | **100/100** | **0** | **11** | **0** |

The **first returned qualifying chart** has the same totals: zero imported tempo and 11 rhythm-bearing songs. This is not an automatic-selection guarantee: the recognition screen also applies known album/duration preferences and asks the user to choose when multiple candidates remain.

Of the 11 strumming results, **seven contain a global pattern and four contain section-only settings**, totaling eight named section assignments. All emitted patterns in this run are strumming patterns in 4/4 with two subdivisions per beat. No accepted live chart returned a picking pattern; picking support is demonstrated by provider/parser and selection/save fixtures, not by live availability in this corpus.

**Zero source-tempo imports does not mean that these songs have no published BPM anywhere.** It means that no supported explicit tempo was imported from the accepted, scoped chart content in this run. The separate recognized/identity-checked Shazam/SongBPM tempo path is not part of this corpus audit. Likewise, the remaining 89 songs returned lyrics with chords but no supported accompaniment instruction; a correct playing pattern was not inferred for them.

### Every chart with imported accompaniment

These are all 11 metadata-bearing song identities from the final raw results. Section names and pattern grids are recorded as returned. A section-only assignment is not promoted to a whole-song pattern.

| ID | Fixed query identity | Source chart | Imported strumming scope and grid |
| --- | --- | --- | --- |
| `021` | KALUSH — Зорі | [Musicaccord.ru](https://musicaccord.ru/songs/kalush-zori/) | вступление: `DUDUDUDU` |
| `031` | Кино — Группа крови | [Akkords.pro](https://akkords.pro/songs/kino/gruppa-krovi/) | вступление: `D-U-D-U-` |
| `033` | Кино — Пачка сигарет | [Akkords.pro](https://akkords.pro/songs/kino/pachka-sigaret/) | Global: `D-U-D-U-` |
| `038` | Гражданская Оборона — Всё идёт по плану | [Akkords.pro](https://akkords.pro/songs/grob/vsyo-idyot-po-planu/) | Global: `D-D-D-D-` |
| `042` | Сплин — Моё сердце | [Akkords.pro](https://akkords.pro/songs/splin/mojo-serdce/) | куплет 1: `D-DU-UDU`; куплет 4: `D-DU-UDU` |
| `043` | Би-2 — Полковнику никто не пишет | [Akkords.pro](https://akkords.pro/songs/bi-2/polkovniku-nikto-ne-pishet/) | Global: `DDDDDDDD` |
| `045` | Король и Шут — Лесник | [Akkords.pro](https://akkords.pro/songs/korol-i-shut/lesnik/) | куплет 1: `D-U-D-U-`; припев: `D-DU-UDU`; куплет 2: `D-U-D-U-`; куплет 3: `D-U-D-U-` |
| `046` | Король и Шут — Кукла колдуна | [Akkords.pro](https://akkords.pro/songs/korol-i-shut/kukla-kolduna/) | Global: `D-DU-UDU` |
| `047` | ДДТ — Что такое осень | [Akkords.pro](https://akkords.pro/songs/ddt/chto-takoe-osen/) | Global: `D-DU-UDU` |
| `048` | ДДТ — Просвистела | [Akkords.pro](https://akkords.pro/songs/ddt/prosvistela/) | Global: `D-DU-UDU` |
| `103` | Nervy — Батареи | [Akkords.pro](https://akkords.pro/songs/nervy/batarei/) | Global: `D-DU-UDU` |

The [raw JSONL](recognition-arrangement-results-100-2026-11-25.jsonl) preserves all 100 identities and every returned option, including entries without metadata. It stores metadata and evidence, not copyrighted lyric/chart bodies.

### Downloaded artifact and source identity

| Provenance field | Verified value |
| --- | --- |
| Source commit | `7a3b0cedabe18502fe38cc1fd444d18c1cf7a5ff` |
| Source tree | `a0ee2abaf9885492eae26ec26bad4ddde9d8b7f7` |
| Run / job | `45566259163` / `139041683080` |
| Runtime | GitHub Actions, Linux, Node `v22.23.5` |
| UTC start / finish | `2026-11-25 07:12:26.843` / `07:25:22.042` |
| Duration | 12 minutes 55.199 seconds |
| Artifact ID / ZIP bytes | `15000816016` / `22,178` |
| Artifact ZIP SHA-256 | `fee6a0200f904e82df3d3d54096dce92b9e6d17309175ac4c61b33fd5129059a` |
| JSONL SHA-256 | `11a5fa2782112a1d546e7261ce06f7a0b0c8624593e29fce2751e103b7bd32aa` |
| Summary SHA-256 | `18c175328c31c84ac1b14df8e2195fa491238c437fce1abaa6b267009bcd35e3` |

The run header and completed summary agree on the manifest, all 100 outcomes and all nine loaded runtime-module hashes. Those hashes were checked against the published source. The [investigation record](recognition-arrangement-investigation-2026-11-25.json) preserves the hash inventory, comparison, metadata rows, development regression evidence and completed source CI. Requests remained sequential by song with the application's existing provider concurrency, 60-second per-song deadline, cancellation and cooldown behavior.

## Practical limits

The source must publish a supported explicit instruction. Missing, conflicting, inaccessible or unsupported instructions stay unset. A saved song with no imported tempo can use the application's existing 80 BPM practice default; that default is not a measured or source-confirmed song tempo.

Preserving numeric picking strings, rests and compatible meter avoids specific interpretation errors. It does not independently establish correct harmony, tuning, fingering, tempo, groove or the arrangement's faithfulness to a recording. Source identity checks and lyric corroboration are not musical validation.

This continuation adds no audio beat, strumming or picking inference. It provides no new physical Android/iPhone capture evidence, changes no platform restrictions on internal audio and does not prove universal song coverage. A complete title/artist content audit must remain distinct from recognizing 100 recordings or testing 100 songs on devices.
