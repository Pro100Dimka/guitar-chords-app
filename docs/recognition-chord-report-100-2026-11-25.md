# 100-song lyrics-and-chords lookup audit — 25 November 2026

## Final completed result: 93 of 100 at checkpoint `4d38baf`

The completed [GitHub Actions audit, run 45534938428](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45534938428), returned an identity-verified arrangement passing the automated **lyrics-and-chords check for 93 of 100 distinct song identities**. The remaining seven queries returned only lyrics; none returned no matching content. This run did not achieve 100/100.

This is a catalogue-lookup audit of the actual `lookupSongContent` implementation. It does not test 100 audio recordings, Shazam recognition, or microphone/phone-audio capture on physical devices. The unchanged per-request evidence is in the [final CI JSONL](recognition-chord-final-results-100-2026-11-25.jsonl) and [summary](recognition-chord-final-results-100-2026-11-25.summary.json). The earlier local and CI snapshots remain preserved below.

| Snapshot field | Recorded value |
| --- | --- |
| Commit | [`4d38baffee9b32f229d1205c1e37d358e08544ce`](https://github.com/Pro100Dimka/guitar-chords-app/commit/4d38baffee9b32f229d1205c1e37d358e08544ce) |
| Environment | GitHub Actions, Linux, Node `v22.23.5` |
| UTC start / finish | `2026-11-25 02:43:40.924` / `02:56:21.523` |
| Duration | 12 minutes 40.599 seconds |
| Frozen manifest | [Validated 100 identities](recognition-chord-corpus-validated-100-2026-11-25.json) |
| Manifest SHA256 | `3bc61bf3c8fa9ff31eb467244ad17008a4f2f412cc072e95811b0c23f9911a82` |
| `lyrics.ts` SHA256 | `7d78c8ade7f7499b8a59e75b53ab83930e0c884c6b45ce16bd63bf1d304910c3` |
| `chords.ts` SHA256 | `54b71903e454be197688fc814d064c2543a59864551156cf1f83d3bb86ae6c18` |
| `rhythms.ts` SHA256 | `2585216e3de308374e9b660c8f2f5c43fed9085667a2b8a6db0c1da984651459` |
| Results JSONL SHA256 | `0b573dcae35c41aeab9090187c877cf065af2e1e43175633ae5407572aa9c917` |
| CI artifact ID | `14987083753` |
| Artifact ZIP SHA256 | `5bb7a7e0a891fc724afd0b52b0bdb31a7cd9b540aa709f273085112760b3d08c` |

| Repertoire cohort | Tested | Lyrics + chords | Lyrics only | No matching content |
| --- | ---: | ---: | ---: | ---: |
| Ukrainian | 30 | 28 | 2 | 0 |
| Russian | 30 | 29 | 1 | 0 |
| English | 30 | 29 | 1 | 0 |
| Other | 10 | 7 | 3 | 0 |
| **Total** | **100** | **93** | **7** | **0** |

These are the original repertoire cohorts, not a certified language distribution. For example, 010 is the Russian-language original by a Ukrainian artist. The other cohort includes Spanish, French, Portuguese, Italian, Polish, Japanese and Korean repertoire. Cohorts and query spellings are preserved in the frozen manifest.

## Historical snapshots and corpus integrity

| Completed snapshot | UTC start → finish on 25 November | Lyrics + chords / lyrics only / no match | Evidence |
| --- | --- | --- | --- |
| Original local run, Linux Node `v24.22.3` | `00:33:42.203` → `00:56:30.002` | **74 / 22 / 4** | [Original JSONL](recognition-chord-results-100-2026-11-25.jsonl), [summary](recognition-chord-results-100-2026-11-25.summary.json) |
| First CI run, `13e1ba2` | `01:30:53.942` → `01:44:16.637` | **89 / 10 / 1** | [Run 45526245678](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45526245678), [JSONL](recognition-chord-ci-results-100-2026-11-25.jsonl), [summary](recognition-chord-ci-results-100-2026-11-25.summary.json) |
| Second CI run, `41350a6` | `02:12:35.451` → `02:26:05.916` | **91 / 9 / 0** | [Run 45531221784](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45531221784), [JSONL](recognition-chord-ci-results-100-2026-11-25-41350a6.jsonl), [summary](recognition-chord-ci-results-100-2026-11-25-41350a6.summary.json) |
| Final CI run, `4d38baf` | `02:43:40.924` → `02:56:21.523` | **93 / 7 / 0** | [Run 45534938428](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45534938428), [JSONL](recognition-chord-final-results-100-2026-11-25.jsonl) |

The original 74/100 implementation **already included earlier fixes**; it is not the original main-branch baseline. Its source and input hashes remain separate from the later checkpoints:

| Historical field | Recorded value |
| --- | --- |
| Original manifest SHA256 | `50eaa10a5a403868cad7ac49c06bd539c7c76ff15df8729045168a4ec5105a20` |
| Original `lyrics.ts` SHA256 | `63fe577d22f287b91be1aa0ed821ff92b1557759ebba07de6f101d19c66622ce` |
| First CI full commit | `13e1ba205092142538db86ac26e8948fcb1c3627` |
| First CI `lyrics.ts` SHA256 | `9644945d2c09e6847f3bd89615475e0e28c7cee1cbf71ae694e7aac9dedbe6f0` |
| Second CI full commit | `41350a64cfafa3312795a936272191b316d2c86b` |
| Second CI `lyrics.ts` SHA256 | `cee0520fefd23de7eab3a691ed647fee42e0fcc540ed2995e642560cc7c62e46` |
| Original, first and second CI `chords.ts` SHA256 | `7daa443978b10db8e42653b4551831fd1e972581b2c140fd19f92d998590dd6a` |

All three CI runs used the exact validated-manifest hash shown above and Linux Node `v22.23.5`; `rhythms.ts` is unchanged across all four snapshots. Between the first and second CI runs, only **008 — ТДМЕ** and **029 — Понад хмарами** changed status, both recovering. Between the second and final CI runs, only **069 — Shape of You** and **097 — Caruso** changed status, both recovering. There were **zero regressions** between these completed CI snapshots.

An [identity audit](recognition-corpus-identity-audit-2026-11-25.jsonl) identified three invalid or unverified input pairs. The [validated manifest](recognition-chord-corpus-validated-100-2026-11-25.json) records their retirement, primary Apple catalogue evidence and replacement identities, frozen at **`2026-11-25T01:09:56.050Z`, before any chord queries for those new entries**.

| Retired input | Reason | Newly fixed identity | Latest CI result |
| --- | --- | --- | --- |
| 049 — Небо Лондон / Григорий Лепс & Тимати | The credited recording is titled Лондон. | 101 — Лондон / Григорий Лепс & Timati | Lyrics only |
| 050 — Девочка, живи! / Мот | This title/artist pair could not be verified. | 102 — Капкан / МОТ | Lyrics + chords |
| 060 — Где ты / Нервы | This title/artist pair could not be verified. | 103 — Батареи / Nervy | Lyrics + chords |

All three retired attempts were `no_matching_arrangement` and remain in the original data. **No failed, valid song was removed to improve the score.** The other 97 title/artist queries are unchanged. On those shared 97, the completed scores were **74 → 87 → 89 → 91**, with no regression among the original 74 successes. Code, runtime/network and three inputs differ between the local and CI runs, so the full-corpus **74→89→91→93** history is not a controlled measure of a code-only improvement.

## What counts as success

The [runner](../scripts/check-chord-corpus.cjs) loads the real TypeScript modules and calls `lookupSongContent(title, artist, signal)` for each fixed pair. A song passes only if the provider verifies its identity, the harness repeats title/artist field checks using production normalization, and the same returned arrangement has `hasChords` plus `hasSongChordsAsync(content, signal, true)`. Lyrics from one source are never combined with chords from an unrelated source.

The strict content validator requires recognised chord notation and lyric evidence beyond headings, metadata, credits, diagrams or tab rows. Malformed-marker and heading guards are included in this final checkpoint. This remains an automated content test: a pass does not prove every verse is present or that the published harmony, key, tempo, strumming or picking pattern matches the recording.

One process handles one song at a time, with a 60-second song deadline. Existing provider concurrency, 12-second page timeouts, cancellation, size limits and 403/429 cooldowns remain active. Пісенник requests retain at least ten seconds between starts. Successful alternatives may cancel other in-flight requests; an `AbortError` in a passing row is therefore not automatically a source outage. Logs contain metadata, URLs, content lengths, identity/content flags and request statuses/timing; they do not contain lyric or chart bodies.

## Confirmed causes addressed by this checkpoint

- **Search retrieval:** a combined title/artist query could omit the correct song from limited results. Пісенник now has a bounded title-only fallback, and Akkords.pro retries by title after no verified candidate. Search and page identities are still checked separately.
- **Search punctuation:** Akkords.pro returned no candidate for `Хочешь?`, but returned the correct Земфира page for `Хочешь`. Only terminal `?`/`!` are removed for that fallback query.
- **Script/credit spelling:** exact cross-script transliteration and mixed-script labels recover cases such as `Okean Elzy` / `Океан Ельзи`, `Кораблі` / published `Кораблi`, and `KAZKA` / published `КАZКА`. There is no fuzzy band-name guessing. Explicit `ВВ (Воплі Відоплясова)` is checked against the full-name initials.
- **Source coverage:** Akkords.pro and Musicaccord.ru add public, identity-checked arrangements. The four existing Latin-specific providers remain inapplicable to non-Latin identities; their paths are not guessed by translating a song title.
- **008 — ТДМЕ:** the first CI run rejected the source-published `TDME (Там Де Ми Є)` spelling before fetching its chart. A synthetic failing-before/passing-after regression led to a narrow acronym-expansion rule checking every initial and limiting `Є → Е` to those initials. The second live run returned the verified Пісенник arrangement.
- **029 — Понад хмарами:** Musicaccord's explicit `span.ch[data-c]` markers were flattened; an adjacent annotation then prevented chord-line detection. A synthetic regression and cached real-HTML replay established the fix. The second live run returned the Musicaccord arrangement; the different Пісенник page remains lyrics-only.
- **069 / 097 — GuitareTab filtering:** the second audit recorded identity-matching rows labelled `tab` that the chords-only filter skipped. The final lookup prioritises `chords` rows, then accepts matching `tab` candidates within the same three-detail limit; page identity and strict content checks remain required. The final run returned both charts.
- **Strict-result guards:** translation/version qualifiers cannot masquerade as acronym expansions. Unsupported Musicaccord markers cannot supply lyric evidence; both returned content and cleaned validation text must pass. Global parser checks exclude structural headings, instrumental instructions, source credits, metadata and tab rows from lyric evidence.
- **False success and outages:** ordinary lyrics no longer count as a prepared recognition result. Complete chord-provider failure is distinguished from a healthy no-match; identified metadata remains available for retry.

The [investigation metadata](recognition-chord-investigation-2026-11-25.json), [focused recheck](recognition-chord-recheck-2026-11-25.jsonl), [earlier eight-song comparison](recognition-chord-check-2026-11-25.json) and [implementation notes](song-autofill.md) retain the evidence. The earlier **4/8→8/8** diagnostic is a separate sample; it is neither the original 100-song baseline nor the completed 93/100 audit.

## All seven misses in the final completed snapshot

Every row below returned matching lyrics but no accepted chart. The explanations retain unresolved search or coverage gaps without claiming global catalogue absence. Cifra Club, E-Chords and Cifras returned HTTP 403 during the run and entered existing cooldowns; missing later requests do not establish that a chart is absent.

| ID | Song / artist | Evidence and remaining limitation |
| --- | --- | --- |
| 010 | Дежавю / Артем Пивоваров | The requested original remains lyrics-only. `Дежавю (UA Version)` is a different language version and must not replace it. The identity audit records both recordings. No verified original-language chart was returned. |
| 012 | Журавлі / The Hardkiss | Bounded searches returned HTTP 200 without an accepted chart. The exact missing-search/candidate cause is unresolved; this does not prove that no chart exists. |
| 101 | Лондон / Григорий Лепс & Timati | No accepted chart. An earlier diagnostic Akkords title-only response contained the different Земфира song `Небо Лондона`, correctly rejected. The final run's bounded searches returned HTTP 200 but established no matching chart. |
| 089 | drivers license / Olivia Rodrigo | The actual GuitareTab combined-query response contains **zero rows**, with page title `No results`. Other bounded searches returned no accepted chart. This is evidence about the recorded query response, not worldwide catalogue absence. |
| 096 | Evidências / Chitãozinho & Xororó | GuitareTab's recorded query `Chitãozinho Evidências` contains **zero rows**, with page title `No results`. No accepted chart came from the other bounded searches. An alternate-query result has not been established. |
| 099 | Lemon / Kenshi Yonezu | The actual GuitareTab combined-query response contains **zero rows**, with page title `No results`. Other searches returned only matching lyrics. This does not establish global absence or prove another spelling would succeed. |
| 100 | 봄날 / BTS | All-script providers returned no accepted chart; the four Latin-specific providers are inapplicable to this Korean title. No alternate title is silently substituted. Broader source coverage remains unverified. |

The first CI JSONL lacked GuitareTab row diagnostics. The second exposed matching `tab` candidates for 069/097 and actual empty responses for 089/096/099; the final run fetched the two candidates successfully and again recorded zero rows for the other three. [Investigation metadata](recognition-chord-investigation-2026-11-25.json) preserves the separate probes and completed snapshots.

## Diagnostic lyric overlap

The final runner optionally compares unique normalized lyric lines against identity-matching LRCLIB `plainLyrics`. **90 of the 93 passing songs had at least one passing arrangement with overlap.** The remaining three are `unknown_no_reference`: **005 — Ліхтарі / O.Torvald**, **008 — ТДМЕ / Антитіла**, and **021 — Зорі / KALUSH**. Missing reference lyrics leave the diagnostic unknown; they do not make a chart pass or fail.

069 returned 4,710 characters from GuitareTab, with **14** overlapping unique lyric lines; 097 returned 2,270 characters, with **one** overlapping line. These are content lengths and line matches, not completeness percentages. For **080 — Losing My Religion**, the first GuitareTab option has `unknown_no_overlap`; a second passing Akkords.pro option overlaps **18** lines. Consequently the first selected sources in the table have 89 overlaps, while the per-song total using any passing option is 90.

This diagnostic **does not change the pass criterion**, certify full lyrics, resolve every spelling/format variation or establish musical correctness. No publisher lyric bodies are stored in the audit. The final score remains the recorded strict lookup result, with these additional observations exposed separately.

## Every tested identity

The table below is generated from the final CI JSONL in manifest order. `PASS` means `lyrics_and_chords`; `TEXT ONLY` means `lyrics_only` and is a failed chord lookup. The source column shows the first qualifying returned arrangement for a pass, or the first identity-matching text-only option for a miss. Full returned metadata/options remain in the JSONL. Original IDs are preserved rather than renumbered after input corrections.

| ID | Title | Artist | Result | Returned source |
| --- | --- | --- | --- | --- |
| 001 | Обійми | Okean Elzy | PASS | [Akkords.pro](https://akkords.pro/songs/okean-elzi/obiymi/) |
| 002 | Без бою | Океан Ельзи | PASS | [Akkords.pro](https://akkords.pro/songs/okean-elzi/bez-boyu/) |
| 003 | Старі фотографії | Скрябін | PASS | [Пісенник](https://pisennyk.com.ua/skryabin/stari-fotografiji) |
| 004 | Люди як кораблі | Скрябін | PASS | [Пісенник](https://pisennyk.com.ua/skryabin/lyudi-yak-korabli) |
| 005 | Ліхтарі | O.Torvald | PASS | [Пісенник](https://pisennyk.com.ua/o-torvald/lihtari) |
| 006 | Наодинці | Бумбокс | PASS | [Akkords.pro](https://akkords.pro/songs/bumboks/naodinci/) |
| 007 | Люди | Бумбокс | PASS | [Musicaccord.ru](https://musicaccord.ru/songs/bumboks-ljudi/) |
| 008 | ТДМЕ | Антитіла | PASS | [Пісенник](https://pisennyk.com.ua/antitila/tdme-tam-de-mi-ye) |
| 009 | Фортеця Бахмут | Антитіла | PASS | [Пісенник](https://pisennyk.com.ua/antitila/fortecya-bahmut) |
| 010 | Дежавю | Артем Пивоваров | TEXT ONLY | [LRCLIB — lyrics only](https://lrclib.net/api/get/11161895) |
| 011 | Маніфест | Артем Пивоваров | PASS | [Пісенник](https://pisennyk.com.ua/artem-pivovarov/manifest) |
| 012 | Журавлі | The Hardkiss | TEXT ONLY | [LRCLIB — lyrics only](https://lrclib.net/api/get/4063115) |
| 013 | Кораблі | The Hardkiss | PASS | [Пісенник](https://pisennyk.com.ua/the-hardkiss/korabli) |
| 014 | Без неї ніяк | БЕЗ ОБМЕЖЕНЬ | PASS | [Musicaccord.ru](https://musicaccord.ru/songs/bez-obmezhen-bez-nei-niyak/) |
| 015 | Човен | Один в каное | PASS | [Пісенник](https://pisennyk.com.ua/odin-v-kanoe/choven) |
| 016 | У мене немає дому | Один в каное | PASS | [Пісенник](https://pisennyk.com.ua/odin-v-kanoe/u-mene-nemaye-domu) |
| 017 | Тримай | Христина Соловій | PASS | [Akkords.pro](https://akkords.pro/songs/hristina-soloviy/trimay/) |
| 018 | Плакала | KAZKA | PASS | [Пісенник](https://pisennyk.com.ua/kazka/plakala) |
| 019 | Шум | Go_A | PASS | [Пісенник](https://pisennyk.com.ua/go-a/shum) |
| 020 | Stefania | Kalush Orchestra | PASS | [Musicaccord.ru](https://musicaccord.ru/songs/kalush-orchestra-stefania/) |
| 021 | Зорі | KALUSH | PASS | [Musicaccord.ru](https://musicaccord.ru/songs/kalush-zori/) |
| 022 | Чути гімн | SKOFKA | PASS | [Пісенник](https://pisennyk.com.ua/skofka/chuti-gimn) |
| 023 | Козацькому роду | Jerry Heil | PASS | [Пісенник](https://pisennyk.com.ua/jerry-heil/kozackomu-rodu) |
| 024 | Teresa & Maria | alyona alyona & Jerry Heil | PASS | [Пісенник](https://pisennyk.com.ua/alyona-alyona/teresa-maria-feat-jerry-heil) |
| 025 | Гранули | ТНМК | PASS | [Musicaccord.ru](https://musicaccord.ru/songs/tnmk-granuli/) |
| 026 | Три хвилини | Друга Ріка | PASS | [Пісенник](https://pisennyk.com.ua/druga-rika/tri-hvilini) |
| 027 | Весна | Воплі Відоплясова | PASS | [Пісенник](https://pisennyk.com.ua/vv-vopli-vidoplyasova/vesna) |
| 028 | Вона | Плач Єремії | PASS | [Musicaccord.ru](https://musicaccord.ru/songs/plach-ieremii-vona/) |
| 029 | Понад хмарами | Тартак | PASS | [Musicaccord.ru](https://musicaccord.ru/songs/tartak-ponad-hmarami/) |
| 030 | Пташечка | Vivienne Mort | PASS | [Пісенник](https://pisennyk.com.ua/vivienne-mort/ptashechka) |
| 031 | Группа крови | Кино | PASS | [Akkords.pro](https://akkords.pro/songs/kino/gruppa-krovi/) |
| 032 | Звезда по имени Солнце | Кино | PASS | [Akkords.pro](https://akkords.pro/songs/kino/zvezda-po-imeni-solnce/) |
| 033 | Пачка сигарет | Кино | PASS | [Akkords.pro](https://akkords.pro/songs/kino/pachka-sigaret/) |
| 034 | Я свободен | Кипелов | PASS | [Akkords.pro](https://akkords.pro/songs/kipelov/ja-svoboden/) |
| 035 | Беспечный ангел | Ария | PASS | [Akkords.pro](https://akkords.pro/songs/arija/bespechnyj-angel/) |
| 036 | Потерянный рай | Ария | PASS | [Akkords.pro](https://akkords.pro/songs/arija/poteryannyj-raj/) |
| 037 | Кукушка | Полина Гагарина | PASS | [Akkords.pro](https://akkords.pro/songs/polina-gagarina/kukushka-2/) |
| 038 | Всё идёт по плану | Гражданская Оборона | PASS | [Akkords.pro](https://akkords.pro/songs/grob/vsyo-idyot-po-planu/) |
| 039 | Вечно молодой | Смысловые Галлюцинации | PASS | [Akkords.pro](https://akkords.pro/songs/smyslovye-gallyutsinatsii/vechno-molodoy/) |
| 040 | Вахтерам | Бумбокс | PASS | [Akkords.pro](https://akkords.pro/songs/bumboks/vaxteram/) |
| 041 | Выхода нет | Сплин | PASS | [Akkords.pro](https://akkords.pro/songs/splin/vyxoda-net/) |
| 042 | Моё сердце | Сплин | PASS | [Akkords.pro](https://akkords.pro/songs/splin/mojo-serdce/) |
| 043 | Полковнику никто не пишет | Би-2 | PASS | [Akkords.pro](https://akkords.pro/songs/bi-2/polkovniku-nikto-ne-pishet/) |
| 044 | Серебро | Би-2 | PASS | [Akkords.pro](https://akkords.pro/songs/bi-2/serebro/) |
| 045 | Лесник | Король и Шут | PASS | [Akkords.pro](https://akkords.pro/songs/korol-i-shut/lesnik/) |
| 046 | Кукла колдуна | Король и Шут | PASS | [Akkords.pro](https://akkords.pro/songs/korol-i-shut/kukla-kolduna/) |
| 047 | Что такое осень | ДДТ | PASS | [Akkords.pro](https://akkords.pro/songs/ddt/chto-takoe-osen/) |
| 048 | Просвистела | ДДТ | PASS | [Akkords.pro](https://akkords.pro/songs/ddt/prosvistela/) |
| 101 | Лондон | Григорий Лепс & Timati | TEXT ONLY | [LRCLIB — lyrics only](https://lrclib.net/api/get/18028980) |
| 102 | Капкан | МОТ | PASS | [Akkords.pro](https://akkords.pro/songs/mot/kapkan/) |
| 051 | Хочешь? | Земфира | PASS | [Akkords.pro](https://akkords.pro/songs/zemfira/hochesh/) |
| 052 | Искала | Земфира | PASS | [Akkords.pro](https://akkords.pro/songs/zemfira/iskala/) |
| 053 | Батарейка | Жуки | PASS | [Akkords.pro](https://akkords.pro/songs/zhuki/batarejka/) |
| 054 | Конь | Любэ | PASS | [Akkords.pro](https://akkords.pro/songs/ljubje/kon/) |
| 055 | Город золотой | Аквариум | PASS | [Akkords.pro](https://akkords.pro/songs/akvarium/gorod-zolotoy/) |
| 056 | Дорога | АукцЫон | PASS | [Akkords.pro](https://akkords.pro/songs/auktsyon/doroga/) |
| 057 | На заре | Альянс | PASS | [Akkords.pro](https://akkords.pro/songs/alyans/na-zare/) |
| 058 | Сансара | Баста | PASS | [Akkords.pro](https://akkords.pro/songs/basta/sansara/) |
| 059 | Мой рок-н-ролл | Би-2 & Чичерина | PASS | [Akkords.pro](https://akkords.pro/songs/bi-2/moy-rok-n-roll/) |
| 103 | Батареи | Nervy | PASS | [Akkords.pro](https://akkords.pro/songs/nervy/batarei/) |
| 061 | Wonderwall | Oasis | PASS | [Akkords.pro](https://akkords.pro/songs/oasis/wonderwall/) |
| 062 | Don't Look Back in Anger | Oasis | PASS | [GuitareTab](https://www.guitaretab.com/o/oasis/232275.html) |
| 063 | Hotel California | Eagles | PASS | [Akkords.pro](https://akkords.pro/songs/eagles/hotel-california/) |
| 064 | Broken | Seether | PASS | [GuitareTab](https://www.guitaretab.com/s/seether/226144.html) |
| 065 | Nothing Else Matters | Metallica | PASS | [Akkords.pro](https://akkords.pro/songs/metallica/nothing-else-matters/) |
| 066 | Enter Sandman | Metallica | PASS | [GuitareTab](https://www.guitaretab.com/m/metallica/24189.html) |
| 067 | Smells Like Teen Spirit | Nirvana | PASS | [Akkords.pro](https://akkords.pro/songs/nirvana/smells-like-teen-spirit/) |
| 068 | Come As You Are | Nirvana | PASS | [GuitareTab](https://www.guitaretab.com/n/nirvana/339445.html) |
| 069 | Shape of You | Ed Sheeran | PASS | [GuitareTab](https://www.guitaretab.com/e/ed-sheeran/389466.html) |
| 070 | Perfect | Ed Sheeran | PASS | [Akkords.pro](https://akkords.pro/songs/ed-sheeran/perfect/) |
| 071 | Someone Like You | Adele | PASS | [GuitareTab](https://www.guitaretab.com/a/adele/255305.html) |
| 072 | Rolling in the Deep | Adele | PASS | [Akkords.pro](https://akkords.pro/songs/adele/rolling-in-the-deep/) |
| 073 | Let It Be | The Beatles | PASS | [Akkords.pro](https://akkords.pro/songs/the-beatles/let-it-be/) |
| 074 | Yesterday | The Beatles | PASS | [Akkords.pro](https://akkords.pro/songs/the-beatles/yesterday/) |
| 075 | Hallelujah | Leonard Cohen | PASS | [Akkords.pro](https://akkords.pro/songs/leonard-cohen/hallelujah/) |
| 076 | Creep | Radiohead | PASS | [GuitareTab](https://www.guitaretab.com/r/radiohead/288870.html) |
| 077 | Yellow | Coldplay | PASS | [GuitareTab](https://www.guitaretab.com/c/coldplay/205446.html) |
| 078 | Viva La Vida | Coldplay | PASS | [GuitareTab](https://www.guitaretab.com/c/coldplay/311790.html) |
| 079 | Zombie | The Cranberries | PASS | [Akkords.pro](https://akkords.pro/songs/the-cranberries/zombie/) |
| 080 | Losing My Religion | R.E.M. | PASS | [GuitareTab](https://www.guitaretab.com/r/rem/238402.html) |
| 081 | Californication | Red Hot Chili Peppers | PASS | [Akkords.pro](https://akkords.pro/songs/red-hot-chili-peppers/californication/) |
| 082 | Knockin' on Heaven's Door | Bob Dylan | PASS | [GuitareTab](https://www.guitaretab.com/b/bob-dylan/295373.html) |
| 083 | Sweet Child O' Mine | Guns N' Roses | PASS | [GuitareTab](https://www.guitaretab.com/g/guns-n-roses/293065.html) |
| 084 | Boulevard of Broken Dreams | Green Day | PASS | [Akkords.pro](https://akkords.pro/songs/green-day/boulevard-of-broken-dreams/) |
| 085 | All of Me | John Legend | PASS | [GuitareTab](https://www.guitaretab.com/j/john-legend/377580.html) |
| 086 | Shallow | Lady Gaga & Bradley Cooper | PASS | [GuitareTab](https://www.guitaretab.com/l/lady-gaga/392084.html) |
| 087 | Take Me to Church | Hozier | PASS | [Akkords.pro](https://akkords.pro/songs/hozier/take-me-to-church/) |
| 088 | Riptide | Vance Joy | PASS | [Akkords.pro](https://akkords.pro/songs/vance-joy/riptide/) |
| 089 | drivers license | Olivia Rodrigo | TEXT ONLY | [LRCLIB — lyrics only](https://lrclib.net/api/get/7518242) |
| 090 | bad guy | Billie Eilish | PASS | [Пісенник](https://pisennyk.com.ua/billie-eilish/bad-guy) |
| 091 | Despacito | Luis Fonsi & Daddy Yankee | PASS | [GuitareTab](https://www.guitaretab.com/l/luis-fonsi/389771.html) |
| 092 | La Camisa Negra | Juanes | PASS | [GuitareTab](https://www.guitaretab.com/j/juanes/266091.html) |
| 093 | Je te promets | Johnny Hallyday | PASS | [GuitareTab](https://www.guitaretab.com/j/johnny-hallyday/299437.html) |
| 094 | Je veux | Zaz | PASS | [Akkords.pro](https://akkords.pro/songs/zaz/je-veux/) |
| 095 | Ai Se Eu Te Pego | Michel Teló | PASS | [Пісенник](https://pisennyk.com.ua/michel-telo/ai-se-eu-te-pego) |
| 096 | Evidências | Chitãozinho & Xororó | TEXT ONLY | [LRCLIB — lyrics only](https://lrclib.net/api/get/6633889) |
| 097 | Caruso | Lucio Dalla | PASS | [GuitareTab](https://www.guitaretab.com/l/lucio-dalla/33843.html) |
| 098 | Dni, których nie znamy | Marek Grechuta | PASS | [Пісенник](https://pisennyk.com.ua/marek-grechuta/dni-ktorych-nie-znamy) |
| 099 | Lemon | Kenshi Yonezu | TEXT ONLY | [LRCLIB — lyrics only](https://lrclib.net/api/get/5394410) |
| 100 | 봄날 | BTS | TEXT ONLY | [LRCLIB — lyrics only](https://lrclib.net/api/get/942430) |

Across the first qualifying arrangements, the sources were Akkords.pro 48, Пісенник 20, GuitareTab 18 and Musicaccord.ru 7. These counts describe the returned results, not each publisher's total catalogue coverage.

## Reproducing the latest completed checkpoint

Use Node 22 and a separate checkout of the recorded source commit. Later evidence-only commits preserve these tested application source hashes. From the repository root:

```sh
git worktree add --detach ../chord-audit-4d38baf 4d38baffee9b32f229d1205c1e37d358e08544ce
cd ../chord-audit-4d38baf
npm ci --ignore-scripts
node scripts/check-chord-corpus.cjs \
  docs/recognition-chord-corpus-validated-100-2026-11-25.json \
  chord-corpus-replay.jsonl
```

The runner refuses to overwrite an existing output and validates 100 unique identities and cohort counts before starting. It writes a companion `.summary.json`. An optional final argument such as `008,029` selects a labelled subset of the same full manifest; a subset is not a new 100-song score. Do not run multiple audit workers concurrently against Пісенник. The [reusable CI workflow](../.github/workflows/chord-corpus-audit.yml) is now an on-demand `workflow_dispatch` audit; required validation/native gates remain unchanged. A green audit means all 100 attempts completed and evidence was saved; it does not mean every lookup passed. Repeating the same code can yield different results as networks and publishers change.

## Device verification and limits of this evidence

At the same `4d38baf` source checkpoint, [validation run 45534938382](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45534938382) passed **1,035 Jest tests in 40 suites**, TypeScript, ESLint and SQLite integration. [Native CI 45534938501](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45534938501) passed Android Kotlin compilation for the app and its dependencies, all three Rust JNI architectures, playback checks, and iOS production PCM/lifecycle fixtures. [iOS build 45534938412](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45534938412) completed the simulator app with both extensions embedded (`BUILD SUCCEEDED`). No signed physical-iPhone or physical-Android capture run is claimed. Details are in [song-autofill.md](song-autofill.md).

The [genuine-audio check 45534938495](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45534938495) positively identified Gloria Gaynor — I Will Survive with HTTP 200; two optional Beethoven samples returned no match. It does not validate recognition of the 100 catalogue identities in this report or demonstrate device-audio capture on a physical phone.

A successful chart can be shorter than the recording. The earlier checked Hotel California arrangement contained the first verse and chorus; content completeness is not part of this pass condition. Published chords have not been audited for musical correctness, tempo, strumming or picking. No chords are generated from ordinary lyrics to make a test pass.

Public catalogue coverage, source spellings, access restrictions, changing HTML and capture restrictions on phones remain practical limits. **Neither 93/100 on this fixed repertoire nor a passing fixture guarantees an accessible, complete or musically correct arrangement for every song.** All seven unsuccessful cases remain available for investigation, alongside the unchanged historical evidence.
