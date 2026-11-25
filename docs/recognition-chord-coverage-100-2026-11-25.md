# Follow-up 100-song lyrics-and-chords audit — 25 November 2026

## Final completed result: 100 of 100

The completed [corrected-source audit, run 45559336274](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45559336274), returned accepted **lyrics with chords for all 100 of the same 100 fixed song identities: 100/100, zero lyrics-only results and zero misses**. All seven previous failures recovered, and all 93 previous passes remained passes. The unrelated secondary LalaTracker London chart found during review is absent from the final returned options.

This result is from a new complete run after the source-quality correction. The exact evidence is preserved in the [final JSONL](recognition-chord-coverage-results-100-2026-11-25.jsonl) and [summary](recognition-chord-coverage-results-100-2026-11-25.summary.json). The audited application source is [`e56339216041ad5fe190d56300938330ef9cf4a9`](https://github.com/Pro100Dimka/guitar-chords-app/commit/e56339216041ad5fe190d56300938330ef9cf4a9), tree `cc56f93c5cd886c75552de5f0936bcc92fe05bfe`, on [PR #13](https://github.com/Pro100Dimka/guitar-chords-app/pull/13). Later evidence/documentation commits preserve this tested source.

The earlier [93/100 report](recognition-chord-report-100-2026-11-25.md) and the [first complete 100/100 JSONL](recognition-chord-coverage-results-100-2026-11-25-017635a.jsonl) remain preserved. The intermediate run had a valid London arrangement plus an unrelated extra option; the final run retains the valid arrangement and excludes that extra option. Its cause and correction are disclosed below.

This is a fixed-corpus content-lookup result. It does not mean 100 captured audio recordings were recognized or that every song has a complete, musically exact arrangement.

## Scope and unchanged test identities

This audit calls the production `lookupSongContent(title, artist, signal)` implementation using the same [frozen manifest](recognition-chord-corpus-validated-100-2026-11-25.json) as the previous 93/100 CI run. The manifest SHA-256 remains **`3bc61bf3c8fa9ff31eb467244ad17008a4f2f412cc072e95811b0c23f9911a82`**. No title, artist, cohort, ID or ordering was changed for this follow-up; no previously failing song was exchanged for another song.

The manifest retains 30 Ukrainian-repertoire, 30 Russian-repertoire, 30 English-repertoire and 10 other-repertoire entries. These are repertoire cohorts, not a certified distribution of lyric languages. In particular, entry `010` is the original Russian-language recording by a Ukrainian artist. The three historical identity corrections predating all validated-manifest CI runs remain fully disclosed in the [previous report](recognition-chord-report-100-2026-11-25.md#historical-snapshots-and-corpus-integrity); this continuation makes no additional corrections.

A pass requires an identity-verified returned arrangement whose actual content passes `hasSongChordsAsync(content, signal, true)`: lyrics and recognized chord notation must both be present. Lyrics-only results remain failures. The [audit runner](../scripts/check-chord-corpus.cjs) repeats the title/artist and content checks and records URLs, lengths, flags, timings and hashes, without saving lyric or chart bodies.

This is a **content-lookup test using 100 fixed title/artist identities**, not recognition of 100 audio recordings, microphone capture on 100 songs, or testing on physical Android/iPhone devices. It does not establish universal catalogue coverage, complete lyrics, correct harmony/key, tempo, strumming or picking patterns.

## Why the previous seven songs failed

All seven previous misses finished normally in approximately 16–20 seconds. Across those rows, the recorded implementation issued **53 network requests, all HTTP 200**, but fetched no chart-detail page. These misses therefore occurred during source discovery or identity filtering, before chart extraction. The 60-second song deadline, the strict content parser and the 1.5-second collection period after a successful chart do not explain these particular failures.

For `089`, `096` and `099`, the recorded GuitareTab search responses explicitly contained zero result rows. That establishes the result of those particular queries, not global absence of the songs. Cifra Club, E-Chords and Cifras had returned HTTP 403 elsewhere in the run and entered their existing cooldowns. Their later skipped requests do not establish catalogue absence either.

The change adds bounded public-catalogue fallbacks after existing chord providers finish without an accepted arrangement. A normal successful lookup retains its earlier request path. The new providers share the existing request timeouts, response limits, cooldowns, cancellation and strict identity/content helpers; this work does not bypass access denials or add a paid API/server.

| New source | Discovery and validation decision | Recovery in the final corrected run |
| --- | --- | --- |
| [Akkords.fun](../src/components/song-autofill/akkords-fun.ts) | Read public artist indexes, verify the artist page and song listing, then verify the detail heading/breadcrumbs and its dedicated chord sheet. The site's disallowed search endpoint is not used. | `012` Журавлі; `101` Лондон |
| [Chords & Tabs](../src/components/song-autofill/chords-and-tabs.ts) | Submit the published search form; accept bounded matching chart links; require agreement between visible and structured identities; preserve inline chord positions and unchorded lyric lines in the dedicated chart. | `089` drivers license; `099` Lemon |
| [Sonidos](../src/components/song-autofill/sonidos.ts) | Verify the artist card and song link, then the detail identity and scoped arrangement. Preserve aligned lyric/chord rows and import intro markers once. | `096` Evidências |
| [WeingGuitar](../src/components/song-autofill/weing-guitar.ts) | Search Korean identities; verify search/detail labels; accept only an explicitly published Hangul/Latin artist alias pair; preserve native Korean lyric fragments and chord positions. | `100` 봄날 |
| [LalaTracker](../src/components/song-autofill/lalatracker.ts) | Verify search label, same-URL structured composition, visible/structured breadcrumbs, heading and dedicated chart. The corrected rule requires the additional single-reference lyric identity check for all candidates, including exact artist names. | `010` Дежавю, original Russian version |

These are general catalogue adapters, not a map of the seven tested songs to hard-coded chart URLs. Candidate counts remain bounded. Source-specific section headings, annotations, diagrams, malformed markers and UI text cannot independently establish a valid lyric-and-chord result. Sonidos and Akkords.fun retain section labels for display but exclude them from separate validation text, closing the false-positive case where an unknown heading plus a chord-only chart was mistaken for lyrics.

### LalaTracker: source-quality correction and identity evidence

The source publishes the performer of `010` as **`Пивоваров Артем`**, while the fixed query is **`Артем Пивоваров`**. The first checkpoint permitted only a two-word Cyrillic reversal and required that candidate to match **one** already-running, identity-matched LRCLIB reference on at least **four unique eligible lyric lines** and **50% of the candidate's eligible lines**. It preserved the exact source credit in `sourceArtist` and the reference URL and counts in `identityReference`. That protected the reversed-name case but did not cover a mislabeled chart whose artist name matched exactly.

After the first complete run, the [secondary LalaTracker London chart](https://lalatracker.com/chords/grigoriy_leps/5b73464b5b45d41de036fd04-london__feat__timati_) was inspected directly. Its body is **«Ты чего такой серьёзный»**, despite the page's London metadata. It shares neither normalized lines nor normalized five-word sequences with the requested London lyrics. The [investigation record](recognition-chord-coverage-investigation-2026-11-25.json) preserves its URL, content hash, evidence and post-fix checks. The first Akkords.fun London arrangement matches 50 reference lines and remains valid.

The correction applies the same **four-line and 50% single-reference check to every LalaTracker candidate**, including exact title/artist matches. Counts cannot be pooled across references; inadequate or unavailable reference evidence causes rejection. A direct production-adapter probe rejects the mislabeled London page, and the final full-corpus result contains only the valid Akkords.fun London option. The original Дежавю remains accepted with 19 of 22 eligible candidate lines matched against one reference.

The arrangement's lyrics and chords remain entirely from LalaTracker. LRCLIB supplies identity evidence only; its lyrics are not inserted into, substituted for, or combined with the chart. The gate reuses the existing lyric request and does not add another service call. The source credit remains recorded, and the separate `Дежавю (UA Version)` recording is not substituted for the original.

### Script and arrangement disclosures

The recovered **Lemon** arrangement contains **romanized Japanese lyrics**, not Japanese kanji/kana. This is the same published song identity and is not an English translation; the writing system is disclosed rather than presented as native Japanese script. The recovered **봄날** chart contains native Korean lyrics. WeingGuitar explicitly prints `방탄소년단(BTS)`; the adapter uses the published `BTS` alias without translating the song title.

`101` is requested with the joint credit `Григорий Лепс & Timati`; Akkords.fun attributes the arrangement to the credited performer `Григорий Лепс`. The existing credited-performer matching rule accepts that credit. The source attribution remains visible in the returned option and evidence.

## Focused development probes

Two completed local probes recovered the seven previous misses before publication: six selected identities, followed by the separate `010` check. Their metadata, source hashes and discarded candidate evidence are preserved in the [follow-up investigation record](recognition-chord-coverage-investigation-2026-11-25.json). These were **working-tree development probes**, not the final committed full-corpus run. Their headers correctly retain the then-current Git HEAD `d4f7e06` and the loaded module hashes. They must not be combined with the older 93 passes and presented as a completed 100/100 run.

| Probe | Selected IDs | Actual result | Runtime / timing |
| --- | --- | --- | --- |
| Six recovered identities | `012,101,089,096,099,100` | 6/6 lyrics + chords | Linux, Node `v24.22.3`; `2026-11-25T05:41:59.117Z` → `05:43:57.474Z` |
| Original Дежавю | `010` | 1/1 lyrics + chords | Linux, Node `v24.22.3`; `2026-11-25T05:49:51.372Z` → `05:50:09.051Z` |

## Final CI provenance and source hashes

| Provenance field | Recorded value |
| --- | --- |
| Audited source commit | `e56339216041ad5fe190d56300938330ef9cf4a9` |
| Source tree | `cc56f93c5cd886c75552de5f0936bcc92fe05bfe` |
| Run/job | [45559336274/139018978207](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45559336274/job/139018978207) |
| Environment | GitHub Actions, Linux, Node `v22.23.5` |
| UTC start/finish | `2026-11-25 06:16:26.375` / `06:29:20.563` |
| Kyiv start/finish | `2026-11-25 08:16:26.375` / `08:29:20.563` |
| Duration | 12 minutes 54.188 seconds |
| Manifest SHA-256 | `3bc61bf3c8fa9ff31eb467244ad17008a4f2f412cc072e95811b0c23f9911a82` |
| Final JSONL SHA-256 | `c94bcd9d2153093726ba74d45415dfd3ef2e2551951130e1709bb90f5a2ba5b4` |
| Summary JSON SHA-256 | `94c6befa3e50bd10b489c0f6cfc2f93faf2f5be22574f3561ff53264a9152487` |
| Artifact ID/ZIP bytes | `14998535017` / `21,546` |
| Artifact ZIP SHA-256 | `9501f00f56190e5c7db2d03524be25376cca338a13ecab9bd6130d03648efba1` |

The downloaded JSONL and summary agree on all 100 completed attempts, statuses, cohorts, manifest and loaded-source hashes. Every row was checked against the exact manifest identity and order. All returned options pass the recorded identity/content flags; the known mislabeled LalaTracker London URL is no longer returned. The loaded runtime hashes match the published files:

| Loaded runtime module | SHA-256 |
| --- | --- |
| `src/components/song-autofill/lyrics.ts` | `5999ea7e617a5c6b67750a8498792c7af910889170d1da7b928c8e83d73615e5` |
| `src/screens/song/chords.ts` | `54b71903e454be197688fc814d064c2543a59864551156cf1f83d3bb86ae6c18` |
| `src/screens/song/rhythms.ts` | `2585216e3de308374e9b660c8f2f5c43fed9085667a2b8a6db0c1da984651459` |
| `src/components/song-autofill/chords-and-tabs.ts` | `7101779c98a5ab0ed8f2473b1d9c301003634c245528ccccb249f7e19b58af16` |
| `src/components/song-autofill/sonidos.ts` | `8f1bb2e3925e359a0a87e819f629a9597cac9898463f3178ea316a2eb2da8f73` |
| `src/components/song-autofill/weing-guitar.ts` | `ff83fb26e893830f85c546401c5fd7bf597ca7596b0e57115b84e44bb46ba14d` |
| `src/components/song-autofill/akkords-fun.ts` | `ce20f2859130e703407c1322a4346e948af7f64fc40e45254d4e27eaad3e382b` |
| `src/components/song-autofill/lalatracker.ts` | `2196d8cf940b0ce1b32b468fe7b3a90a8e0b556b11005d9afe1c58c3d7e88d05` |

The audit uses one process and one song at a time, a 60-second song deadline, the application's usual provider concurrency, 12-second page timeouts, cancellation, response limits and 403/429 cooldowns. Пісенник retains at least 10 seconds between request starts. A passing lookup may cancel other in-flight requests; such `AbortError` entries are not failed song lookups. The batch duration includes the real waits and network work.

## Comparison and preserved history

All compared runs use the same frozen manifest and Linux Node `v22.23.5`. The final comparison against the previous 93/100 run is **seven recoveries and zero status regressions**. The first complete follow-up and its defect remain archived; no earlier result was overwritten.

| Checkpoint | Source | Lyrics+chords | Remaining misses | Evidence/qualification |
| --- | --- | ---: | ---: | --- |
| Previous completed audit | `4d38baf` |93 |7 | [Run45534938428](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45534938428); [raw results](recognition-chord-final-results-100-2026-11-25.jsonl) |
| First complete follow-up | `017635a` |100 |0 | [Run45556572575](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45556572575); [raw](recognition-chord-coverage-results-100-2026-11-25-017635a.jsonl), [summary](recognition-chord-coverage-results-100-2026-11-25-017635a.summary.json). London also had the unrelated secondary option described above. |
| Final corrected source | `e563392` |100 |0 | [Run45559336274](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45559336274); [final raw](recognition-chord-coverage-results-100-2026-11-25.jsonl). London retains its valid arrangement and excludes the mislabeled option. |

This is not a comparison with an anecdotal success rate or the earlier local 74/100 development snapshot.

| Repertoire cohort | Tested | Previous passes | Final passes | Recovered | Remaining failures |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ukrainian | 30 | 28 | 30 | +2 |0 |
| Russian | 30 | 29 | 30 | +1 |0 |
| English | 30 | 29 | 30 | +1 |0 |
| Other | 10 | 7 | 10 | +3 |0 |
| **Total** | **100** | **93** | **100** | **+7** | **0** |

All seven rows below were `lyrics_only` previously and are `lyrics_and_chords` in the final full run. Character counts describe the returned content; line counts are optional audit matches, not lyric-completeness percentages.

| ID | Fixed query | First qualifying source in the final run | Content characters | Matched lyric lines |
| --- | --- | --- | ---: | ---: |
| 010 | Дежавю / Артем Пивоваров | [LalaTracker](https://lalatracker.com/chords/pivovarov_artem/5dcb15afe0231032482e9d1f-dezhavyu) | 1,937 | 18 |
| 012 | Журавлі / The Hardkiss | [Akkords.fun](https://akkords.fun/eng/the-hardkiss/zhuravli/) | 720 | 13 |
| 101 | Лондон / Григорий Лепс & Timati | [Akkords.fun](https://akkords.fun/rus/grigoriy-leps/london/) | 2,729 | 50 |
| 089 | drivers license / Olivia Rodrigo | [Chords & Tabs](https://www.chords-and-tabs.net/song/name/olivia-rodrigo-drivers-license) | 2,100 | 25 |
| 096 | Evidências / Chitãozinho & Xororó | [Sonidos](https://www.sonidos.com.br/chitaozinho-xororo/evidencias) | 3,699 | 19 |
| 099 | Lemon / Kenshi Yonezu | [Chords & Tabs](https://www.chords-and-tabs.net/song/name/kenshi-yonezu-lemon) | 2,192 | 33 |
| 100 | 봄날 / BTS | [WeingGuitar](https://guitar.weingchicken.com/scores/147) | 1,439 | 23 |

For `010`, the final option preserves `sourceArtist: "Пивоваров Артем"` and production identity evidence: **19 of 22 eligible candidate lines** matched the single [LRCLIB reference 11161895](https://lrclib.net/api/get/11161895). The optional diagnostic reports 18 matches because it uses separate normalization/eligibility rules. The arrangement remains the original Russian-language version.

First qualifying returned sources are distributed below. These describe ordering, not mutually exclusive catalogue coverage; one song can return several accepted options.

| First qualifying source | Previous 93 passes | Intermediate 100 passes | Final 100 passes |
| --- | ---: | ---: | ---: |
| Akkords.pro | 48 | 43 | 46 |
| Пісенник | 20 | 20 | 21 |
| GuitareTab | 18 | 23 | 20 |
| Musicaccord.ru | 7 | 7 | 6 |
| Akkords.fun | 0 | 2 | 2 |
| Chords & Tabs | 0 | 2 | 2 |
| Sonidos | 0 | 1 | 1 |
| WeingGuitar | 0 | 1 | 1 |
| LalaTracker | 0 | 1 | 1 |
| **Total** | **93** | **100** | **100** |

Three previously passing identities have a different first source in the final run: `007` Люди has Пісенник instead of Musicaccord.ru, while `063` Hotel California and `070` Perfect have GuitareTab instead of Akkords.pro. Their pass status is unchanged. Provider completion order can change which accepted option appears first.

## Optional lyric-line diagnostic

**97 of the 100 passing songs have at least one passing option sharing normalized lyric lines with identity-matched LRCLIB lyrics.** Three identities have no usable reference: `005` Ліхтарі/O.Torvald, `008` ТДМЕ/Антитіла and `021` Зорі/KALUSH. Their status is `unknown_no_reference`.

The first qualifying option has overlap for **96 songs**. For `080` Losing My Religion, the first GuitareTab option has `unknown_no_overlap`, but its second Akkords.pro option matches 18 lines. This explains the difference between 96 first-option and 97 per-song overlaps. For `067` Smells Like Teen Spirit, Akkords.pro is now first and matches 20 lines; its additional GuitareTab option still has no exact overlap.

A bounded direct inspection attempt for those two GuitareTab alternatives received HTTP 403 and stopped without bypassing the restriction. It established no content conclusion about them. Their source metadata and automated content flags are recorded, but the alternatives are not independently corroborated by this lyric-line diagnostic. The separate Akkords.pro options provide the corroborated evidence for those songs.

The known unrelated LalaTracker London option is absent from the final result; its retained Akkords.fun option matches 50 lines. All seven recovered songs have a returned option with lyric-line overlap.

The optional diagnostic does not change the pass/fail criterion, establish complete lyrics or prove musical correctness. Formatting, line wrapping and writing-system differences can affect exact-line comparisons. The mandatory LalaTracker single-reference identity gate is a separate production requirement; the raw evidence records both independently.

## Every tested identity in the final run

The table is generated from the final `e563392` JSONL in unchanged manifest order. `PASS` means `lyrics_and_chords`; `TEXT ONLY` was the previous failed chord lookup. Source and line-count columns refer to the **first qualifying returned option**. They do not claim that every alternative is identical or independently corroborated. Additional options and their diagnostics remain in the raw evidence; original IDs are preserved.

| ID | Title | Artist | Previous run | Final run | First qualifying returned source | Matched lyric lines |
| --- | --- | --- | --- | --- | --- | ---: |
| 001 | Обійми | Okean Elzy | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/okean-elzi/obiymi/) | 5 |
| 002 | Без бою | Океан Ельзи | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/okean-elzi/bez-boyu/) | 11 |
| 003 | Старі фотографії | Скрябін | PASS | PASS | [Пісенник](https://pisennyk.com.ua/skryabin/stari-fotografiji) | 28 |
| 004 | Люди як кораблі | Скрябін | PASS | PASS | [Пісенник](https://pisennyk.com.ua/skryabin/lyudi-yak-korabli) | 18 |
| 005 | Ліхтарі | O.Torvald | PASS | PASS | [Пісенник](https://pisennyk.com.ua/o-torvald/lihtari) | No reference |
| 006 | Наодинці | Бумбокс | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/bumboks/naodinci/) | 6 |
| 007 | Люди | Бумбокс | PASS | PASS | [Пісенник](https://pisennyk.com.ua/bumboks/lyudi) | 1 |
| 008 | ТДМЕ | Антитіла | PASS | PASS | [Пісенник](https://pisennyk.com.ua/antitila/tdme-tam-de-mi-ye) | No reference |
| 009 | Фортеця Бахмут | Антитіла | PASS | PASS | [Пісенник](https://pisennyk.com.ua/antitila/fortecya-bahmut) | 20 |
| 010 | Дежавю | Артем Пивоваров | TEXT ONLY | PASS | [LalaTracker](https://lalatracker.com/chords/pivovarov_artem/5dcb15afe0231032482e9d1f-dezhavyu) | 18 |
| 011 | Маніфест | Артем Пивоваров | PASS | PASS | [Пісенник](https://pisennyk.com.ua/artem-pivovarov/manifest) | 10 |
| 012 | Журавлі | The Hardkiss | TEXT ONLY | PASS | [Akkords.fun](https://akkords.fun/eng/the-hardkiss/zhuravli/) | 13 |
| 013 | Кораблі | The Hardkiss | PASS | PASS | [Пісенник](https://pisennyk.com.ua/the-hardkiss/korabli) | 11 |
| 014 | Без неї ніяк | БЕЗ ОБМЕЖЕНЬ | PASS | PASS | [Musicaccord.ru](https://musicaccord.ru/songs/bez-obmezhen-bez-nei-niyak/) | 17 |
| 015 | Човен | Один в каное | PASS | PASS | [Пісенник](https://pisennyk.com.ua/odin-v-kanoe/choven) | 3 |
| 016 | У мене немає дому | Один в каное | PASS | PASS | [Пісенник](https://pisennyk.com.ua/odin-v-kanoe/u-mene-nemaye-domu) | 20 |
| 017 | Тримай | Христина Соловій | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/hristina-soloviy/trimay/) | 12 |
| 018 | Плакала | KAZKA | PASS | PASS | [Пісенник](https://pisennyk.com.ua/kazka/plakala) | 5 |
| 019 | Шум | Go_A | PASS | PASS | [Пісенник](https://pisennyk.com.ua/go-a/shum) | 12 |
| 020 | Stefania | Kalush Orchestra | PASS | PASS | [Musicaccord.ru](https://musicaccord.ru/songs/kalush-orchestra-stefania/) | 17 |
| 021 | Зорі | KALUSH | PASS | PASS | [Musicaccord.ru](https://musicaccord.ru/songs/kalush-zori/) | No reference |
| 022 | Чути гімн | SKOFKA | PASS | PASS | [Пісенник](https://pisennyk.com.ua/skofka/chuti-gimn) | 8 |
| 023 | Козацькому роду | Jerry Heil | PASS | PASS | [Пісенник](https://pisennyk.com.ua/jerry-heil/kozackomu-rodu) | 4 |
| 024 | Teresa & Maria | alyona alyona & Jerry Heil | PASS | PASS | [Пісенник](https://pisennyk.com.ua/alyona-alyona/teresa-maria-feat-jerry-heil) | 17 |
| 025 | Гранули | ТНМК | PASS | PASS | [Musicaccord.ru](https://musicaccord.ru/songs/tnmk-granuli/) | 36 |
| 026 | Три хвилини | Друга Ріка | PASS | PASS | [Пісенник](https://pisennyk.com.ua/druga-rika/tri-hvilini) | 10 |
| 027 | Весна | Воплі Відоплясова | PASS | PASS | [Пісенник](https://pisennyk.com.ua/vv-vopli-vidoplyasova/vesna) | 1 |
| 028 | Вона | Плач Єремії | PASS | PASS | [Musicaccord.ru](https://musicaccord.ru/songs/plach-ieremii-vona/) | 7 |
| 029 | Понад хмарами | Тартак | PASS | PASS | [Musicaccord.ru](https://musicaccord.ru/songs/tartak-ponad-hmarami/) | 27 |
| 030 | Пташечка | Vivienne Mort | PASS | PASS | [Пісенник](https://pisennyk.com.ua/vivienne-mort/ptashechka) | 15 |
| 031 | Группа крови | Кино | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/kino/gruppa-krovi/) | 15 |
| 032 | Звезда по имени Солнце | Кино | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/kino/zvezda-po-imeni-solnce/) | 24 |
| 033 | Пачка сигарет | Кино | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/kino/pachka-sigaret/) | 12 |
| 034 | Я свободен | Кипелов | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/kipelov/ja-svoboden/) | 31 |
| 035 | Беспечный ангел | Ария | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/arija/bespechnyj-angel/) | 30 |
| 036 | Потерянный рай | Ария | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/arija/poteryannyj-raj/) | 14 |
| 037 | Кукушка | Полина Гагарина | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/polina-gagarina/kukushka-2/) | 7 |
| 038 | Всё идёт по плану | Гражданская Оборона | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/grob/vsyo-idyot-po-planu/) | 26 |
| 039 | Вечно молодой | Смысловые Галлюцинации | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/smyslovye-gallyutsinatsii/vechno-molodoy/) | 5 |
| 040 | Вахтерам | Бумбокс | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/bumboks/vaxteram/) | 35 |
| 041 | Выхода нет | Сплин | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/splin/vyxoda-net/) | 11 |
| 042 | Моё сердце | Сплин | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/splin/mojo-serdce/) | 17 |
| 043 | Полковнику никто не пишет | Би-2 | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/bi-2/polkovniku-nikto-ne-pishet/) | 1 |
| 044 | Серебро | Би-2 | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/bi-2/serebro/) | 3 |
| 045 | Лесник | Король и Шут | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/korol-i-shut/lesnik/) | 9 |
| 046 | Кукла колдуна | Король и Шут | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/korol-i-shut/kukla-kolduna/) | 32 |
| 047 | Что такое осень | ДДТ | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/ddt/chto-takoe-osen/) | 21 |
| 048 | Просвистела | ДДТ | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/ddt/prosvistela/) | 12 |
| 101 | Лондон | Григорий Лепс & Timati | TEXT ONLY | PASS | [Akkords.fun](https://akkords.fun/rus/grigoriy-leps/london/) | 50 |
| 102 | Капкан | МОТ | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/mot/kapkan/) | 14 |
| 051 | Хочешь? | Земфира | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/zemfira/hochesh/) | 16 |
| 052 | Искала | Земфира | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/zemfira/iskala/) | 9 |
| 053 | Батарейка | Жуки | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/zhuki/batarejka/) | 9 |
| 054 | Конь | Любэ | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/ljubje/kon/) | 21 |
| 055 | Город золотой | Аквариум | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/akvarium/gorod-zolotoy/) | 11 |
| 056 | Дорога | АукцЫон | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/auktsyon/doroga/) | 15 |
| 057 | На заре | Альянс | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/alyans/na-zare/) | 9 |
| 058 | Сансара | Баста | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/basta/sansara/) | 12 |
| 059 | Мой рок-н-ролл | Би-2 & Чичерина | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/bi-2/moy-rok-n-roll/) | 12 |
| 103 | Батареи | Nervy | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/nervy/batarei/) | 19 |
| 061 | Wonderwall | Oasis | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/oasis/wonderwall/) | 19 |
| 062 | Don't Look Back in Anger | Oasis | PASS | PASS | [GuitareTab](https://www.guitaretab.com/o/oasis/232275.html) | 14 |
| 063 | Hotel California | Eagles | PASS | PASS | [GuitareTab](https://www.guitaretab.com/e/eagles/286856.html) | 2 |
| 064 | Broken | Seether | PASS | PASS | [GuitareTab](https://www.guitaretab.com/s/seether/226144.html) | 6 |
| 065 | Nothing Else Matters | Metallica | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/metallica/nothing-else-matters/) | 13 |
| 066 | Enter Sandman | Metallica | PASS | PASS | [GuitareTab](https://www.guitaretab.com/m/metallica/24189.html) | 19 |
| 067 | Smells Like Teen Spirit | Nirvana | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/nirvana/smells-like-teen-spirit/) | 20 |
| 068 | Come As You Are | Nirvana | PASS | PASS | [GuitareTab](https://www.guitaretab.com/n/nirvana/339445.html) | 1 |
| 069 | Shape of You | Ed Sheeran | PASS | PASS | [GuitareTab](https://www.guitaretab.com/e/ed-sheeran/389466.html) | 14 |
| 070 | Perfect | Ed Sheeran | PASS | PASS | [GuitareTab](https://www.guitaretab.com/e/ed-sheeran/389470.html) | 10 |
| 071 | Someone Like You | Adele | PASS | PASS | [GuitareTab](https://www.guitaretab.com/a/adele/255305.html) | 3 |
| 072 | Rolling in the Deep | Adele | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/adele/rolling-in-the-deep/) | 14 |
| 073 | Let It Be | The Beatles | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/the-beatles/let-it-be/) | 6 |
| 074 | Yesterday | The Beatles | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/the-beatles/yesterday/) | 8 |
| 075 | Hallelujah | Leonard Cohen | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/leonard-cohen/hallelujah/) | 20 |
| 076 | Creep | Radiohead | PASS | PASS | [GuitareTab](https://www.guitaretab.com/r/radiohead/288870.html) | 12 |
| 077 | Yellow | Coldplay | PASS | PASS | [GuitareTab](https://www.guitaretab.com/c/coldplay/205446.html) | 8 |
| 078 | Viva La Vida | Coldplay | PASS | PASS | [GuitareTab](https://www.guitaretab.com/c/coldplay/311790.html) | 23 |
| 079 | Zombie | The Cranberries | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/the-cranberries/zombie/) | 14 |
| 080 | Losing My Religion | R.E.M. | PASS | PASS | [GuitareTab](https://www.guitaretab.com/r/rem/238402.html) | No exact overlap |
| 081 | Californication | Red Hot Chili Peppers | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/red-hot-chili-peppers/californication/) | 2 |
| 082 | Knockin' on Heaven's Door | Bob Dylan | PASS | PASS | [GuitareTab](https://www.guitaretab.com/b/bob-dylan/295373.html) | 5 |
| 083 | Sweet Child O' Mine | Guns N' Roses | PASS | PASS | [GuitareTab](https://www.guitaretab.com/g/guns-n-roses/293065.html) | 6 |
| 084 | Boulevard of Broken Dreams | Green Day | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/green-day/boulevard-of-broken-dreams/) | 18 |
| 085 | All of Me | John Legend | PASS | PASS | [GuitareTab](https://www.guitaretab.com/j/john-legend/377580.html) | 18 |
| 086 | Shallow | Lady Gaga & Bradley Cooper | PASS | PASS | [GuitareTab](https://www.guitaretab.com/l/lady-gaga/392084.html) | 10 |
| 087 | Take Me to Church | Hozier | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/hozier/take-me-to-church/) | 8 |
| 088 | Riptide | Vance Joy | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/vance-joy/riptide/) | 20 |
| 089 | drivers license | Olivia Rodrigo | TEXT ONLY | PASS | [Chords & Tabs](https://www.chords-and-tabs.net/song/name/olivia-rodrigo-drivers-license) | 25 |
| 090 | bad guy | Billie Eilish | PASS | PASS | [Пісенник](https://pisennyk.com.ua/billie-eilish/bad-guy) | 35 |
| 091 | Despacito | Luis Fonsi & Daddy Yankee | PASS | PASS | [GuitareTab](https://www.guitaretab.com/l/luis-fonsi/389771.html) | 23 |
| 092 | La Camisa Negra | Juanes | PASS | PASS | [GuitareTab](https://www.guitaretab.com/j/juanes/266091.html) | 5 |
| 093 | Je te promets | Johnny Hallyday | PASS | PASS | [GuitareTab](https://www.guitaretab.com/j/johnny-hallyday/299437.html) | 21 |
| 094 | Je veux | Zaz | PASS | PASS | [Akkords.pro](https://akkords.pro/songs/zaz/je-veux/) | 10 |
| 095 | Ai Se Eu Te Pego | Michel Teló | PASS | PASS | [Пісенник](https://pisennyk.com.ua/michel-telo/ai-se-eu-te-pego) | 5 |
| 096 | Evidências | Chitãozinho & Xororó | TEXT ONLY | PASS | [Sonidos](https://www.sonidos.com.br/chitaozinho-xororo/evidencias) | 19 |
| 097 | Caruso | Lucio Dalla | PASS | PASS | [GuitareTab](https://www.guitaretab.com/l/lucio-dalla/33843.html) | 1 |
| 098 | Dni, których nie znamy | Marek Grechuta | PASS | PASS | [Пісенник](https://pisennyk.com.ua/marek-grechuta/dni-ktorych-nie-znamy) | 16 |
| 099 | Lemon | Kenshi Yonezu | TEXT ONLY | PASS | [Chords & Tabs](https://www.chords-and-tabs.net/song/name/kenshi-yonezu-lemon) | 33 |
| 100 | 봄날 | BTS | TEXT ONLY | PASS | [WeingGuitar](https://guitar.weingchicken.com/scores/147) | 23 |

## Verification and practical limits

The final-source [validation CI, run 45559336376](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45559336376), passed **1,202 Jest tests across 46 suites**, TypeScript, ESLint and real SQLite integration. The tests cover provider identities/content, the exact-name LalaTracker mislabel, deferred fallback requests, total chord-source outage, cancellation, bounded collection and late-response/cache behavior. The [investigation record](recognition-chord-coverage-investigation-2026-11-25.json) preserves completed CI verification metadata and direct post-fix probes.

[Native CI, run 45559336344](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45559336344), passed Android application/dependency Kotlin compilation, all three Rust JNI architectures and playback lifecycle fixtures. Its Swift job passed production fixtures including 18 PCM format/rate combinations. The [full iOS application build, run 45559336332](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45559336332), succeeded and verified the simulator application with both extensions embedded. The unsigned iPhone Release step was skipped; this is not proof of a signed physical-device installation.

The separate [real-audio proof, run 45559336331](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45559336331), identified Gloria Gaynor — **I Will Survive** with HTTP 200 and a signature URI length of 5,965 characters. Both optional Beethoven recordings returned HTTP 200 with no matching track. This is one positive audio-recognition proof, not the 100-title lookup audit.

The earlier Android/iPhone capture implementation remains in the same PR. This continuation changes content lookup, provider disclosure and validation; it supplies no new physical-device evidence. Protected or non-capturable player audio remains subject to platform/player restrictions, and the documented iPhone extension signing/App Group requirements still apply.

Live catalogue responses and source quality can change. This 100/100 result demonstrates the recorded fixed-corpus lookup outcome after the known mislabel fix. It does not validate every returned alternative independently, prove full lyrics or musical accuracy, or establish that every recording can always be recognized and supplied with an arrangement.
