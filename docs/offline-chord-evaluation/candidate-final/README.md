# Final frozen comparison: aligned-third-v2

**One fresh candidate evaluation completed. The results are mixed; this is not a claim of professional-quality recognition of arbitrary full songs.**

On the primary fresh12 cohort, exact agreement with the performed annotations improved from **50.55% to 62.03%**, and root agreement from **74.27% to 81.82%**. Exact agreement with the instructed chord sheet fell from **70.28% to 56.26%**. The two references answer different questions and remain separate. Neither is discarded after seeing the outcome.

The decoder and executable were frozen before the fresh labels were opened. Both engines ran once on every fresh take. The original12 had already informed the generic third-consistency correction, so their results below are explicitly development-after-evaluation. No model or threshold was changed after this fresh evaluation.

## Primary fresh12: all duration-weighted metrics

Baseline is the frozen `01ddfeab` chroma-v1 binary. Final is `aligned-third-v2`, binary `840356f7…`. Changes are percentage points; exact/root/Jaccard use all known reference duration.

| Reference | Metric | Baseline | Final | Change (pp) | Denominator (s) |
|---|---|---:|---:|---:|---:|
| instructed | Exact root/formula | 70.28% | 56.26% | -14.02 | 367.988400 |
| instructed | Root only | 74.27% | 81.82% | +7.56 | 367.988400 |
| instructed | Major/minor projection | 74.09% | 73.84% | -0.25 | 362.533855 |
| instructed | Pitch-class Jaccard | 80.66% | 80.05% | -0.61 | 367.988400 |
| performed | Exact root/formula | 50.55% | 62.03% | +11.48 | 367.988400 |
| performed | Root only | 74.27% | 81.82% | +7.56 | 367.988400 |
| performed | Major/minor projection | 80.83% | 83.13% | +2.30 | 319.066504 |
| performed | Pitch-class Jaccard | 79.19% | 85.14% | +5.95 | 367.988400 |

### Denominators and label policy

The 12 PCM inputs contain 367.9884375 seconds; rounded JAMS reference durations sum to 367.988400 seconds. Both annotation timelines are continuous, with zero X/unknown and zero N/no-chord reference seconds. The missing prediction duration is 0.000113 seconds for each engine, caused by endpoint rounding and counted wrong rather than dropped.

| Reference | Outside the 14-formula candidate vocabulary (s) | Excluded from separate major/minor projection (s) |
|---|---:|---:|
| instructed | 5.454545 | 5.454545 |
| performed | 60.867024 | 48.921896 |

Reference formulas outside the candidate vocabulary remain in exact/root/Jaccard denominators. Their labels and durations are listed in summary.json. Unsupported syntax raises an error; missing prediction time and predicted X/N on a chord interval count wrong. N in production means **undetermined/no reliable chord**, not proof of silence or absent harmony. The grader's conventional reference-N rule is retained, but neither cohort contains reference N.

- Exact means the same enharmonic root and relative pitch-class formula; inversions/slash bass are ignored. Added/omitted tones and seventh types remain distinct. Dominant C9 is not globally aliased to Cadd9.
- Root only ignores quality, so it cannot establish that a displayed extended chord is correct.
- Major/minor projection is a separately denominated secondary score: references need a complete, unambiguous major or minor triad. Nonprojectable predictions count wrong on eligible intervals.
- Pitch-class Jaccard measures harmonic similarity, and can be high with a wrong root or quality. It is not exact chord accuracy.

### Every fresh take, including every negative change

Each cell is baseline → final (change in percentage points). All 12 takes are retained. Full precision, numerators, denominators and all negative deltas are also available in summary.json and fresh-holdout/comparison.json.

#### Instructed reference

| Take | Exact root/formula | Root only | Major/minor projection | Pitch-class Jaccard |
|---|---:|---:|---:|---:|
| 00_Funk1-97-C_comp | 72.61% → 60.15% (-12.46) | 77.13% → 75.19% (-1.94) | 72.61% → 75.19% (+2.59) | 75.81% → 75.93% (+0.12) |
| 00_SS1-68-E_comp | 91.74% → 68.45% (-23.30) | 91.74% → 96.88% (+5.14) | 91.74% → 86.10% (-5.64) | 92.52% → 87.65% (-4.87) |
| 01_BN1-147-Gb_comp | 97.32% → 93.48% (-3.84) | 97.32% → 96.61% (-0.71) | 97.32% → 93.48% (-3.84) | 97.73% → 96.24% (-1.49) |
| 01_Jazz3-137-Eb_comp | 88.68% → 83.45% (-5.23) | 89.91% → 89.68% (-0.23) | 88.68% → 89.68% (+1.00) | 90.51% → 89.66% (-0.85) |
| 02_Jazz1-130-D_comp | 95.60% → 95.60% (+0.00) | 95.60% → 95.60% (+0.00) | 95.60% → 95.60% (+0.00) | 96.21% → 96.21% (+0.00) |
| 02_Rock3-148-C_comp | 81.79% → 74.07% (-7.73) | 92.72% → 92.85% (+0.13) | 81.79% → 76.49% (-5.31) | 88.12% → 85.93% (-2.20) |
| 03_BN3-154-E_comp | 57.48% → 0.00% (-57.48) | 57.48% → 64.74% (+7.26) | 57.48% → 38.92% (-18.56) | 72.06% → 55.26% (-16.80) |
| 03_SS2-88-F_comp | 58.66% → 64.75% (+6.09) | 81.52% → 80.22% (-1.29) | 93.16% → 88.08% (-5.09) | 84.13% → 88.62% (+4.49) |
| 04_Funk3-98-A_comp | 9.69% → 7.42% (-2.27) | 9.69% → 38.15% (+28.46) | 9.69% → 36.18% (+26.49) | 37.88% → 52.39% (+14.51) |
| 04_SS1-68-E_comp | 85.43% → 64.88% (-20.55) | 85.83% → 98.79% (+12.96) | 85.43% → 64.88% (-20.55) | 88.47% → 82.30% (-6.17) |
| 05_Jazz3-137-Eb_comp | 43.90% → 5.37% (-38.53) | 43.90% → 74.19% (+30.29) | 43.90% → 74.19% (+30.29) | 68.86% → 71.55% (+2.69) |
| 05_Rock1-130-A_comp | 89.05% → 81.12% (-7.93) | 89.05% → 89.05% (+0.00) | 89.05% → 84.37% (-4.68) | 91.12% → 87.90% (-3.22) |

#### Performed reference

| Take | Exact root/formula | Root only | Major/minor projection | Pitch-class Jaccard |
|---|---:|---:|---:|---:|
| 00_Funk1-97-C_comp | 14.64% → 12.07% (-2.57) | 77.13% → 75.19% (-1.94) | 79.21% → 82.03% (+2.82) | 65.82% → 71.80% (+5.98) |
| 00_SS1-68-E_comp | 87.96% → 68.45% (-19.52) | 91.74% → 96.88% (+5.14) | 91.74% → 86.10% (-5.64) | 91.38% → 88.18% (-3.20) |
| 01_BN1-147-Gb_comp | 97.32% → 93.48% (-3.84) | 97.32% → 96.61% (-0.71) | 97.32% → 93.48% (-3.84) | 97.73% → 96.24% (-1.49) |
| 01_Jazz3-137-Eb_comp | 83.49% → 78.03% (-5.46) | 89.91% → 89.68% (-0.23) | 89.05% → 89.87% (+0.82) | 88.57% → 87.65% (-0.92) |
| 02_Jazz1-130-D_comp | 88.45% → 88.45% (+0.00) | 95.60% → 95.60% (+0.00) | 96.50% → 96.50% (+0.00) | 91.92% → 91.92% (+0.00) |
| 02_Rock3-148-C_comp | 63.78% → 61.72% (-2.07) | 92.72% → 92.85% (+0.13) | 92.72% → 87.90% (-4.81) | 85.68% → 83.96% (-1.72) |
| 03_BN3-154-E_comp | 0.00% → 33.20% (+33.20) | 57.48% → 64.74% (+7.26) | 57.48% → 38.92% (-18.56) | 58.79% → 64.12% (+5.33) |
| 03_SS2-88-F_comp | 52.41% → 59.37% (+6.96) | 81.52% → 80.22% (-1.29) | 93.16% → 88.08% (-5.09) | 81.48% → 85.45% (+3.97) |
| 04_Funk3-98-A_comp | 6.18% → 34.71% (+28.53) | 9.69% → 38.15% (+28.46) | 16.12% → 69.43% (+53.31) | 61.31% → 77.65% (+16.34) |
| 04_SS1-68-E_comp | 66.10% → 97.74% (+31.63) | 85.83% → 98.79% (+12.96) | 99.16% → 97.33% (-1.83) | 83.00% → 98.87% (+15.87) |
| 05_Jazz3-137-Eb_comp | 0.00% → 68.82% (+68.82) | 43.90% → 74.19% (+30.29) | 43.90% → 74.19% (+30.29) | 67.91% → 91.13% (+23.22) |
| 05_Rock1-130-A_comp | 56.69% → 51.83% (-4.86) | 89.05% → 89.05% (+0.00) | 97.81% → 91.85% (-5.96) | 82.22% → 81.22% (-1.00) |

The fresh performed-exact improvement is not uniform: six takes regress, five improve, and one is unchanged. The largest performed-exact decline is 00_SS1-68-E_comp (87.96% → 68.45%, −19.52 pp). The final root score on 04_Funk3-98-A_comp is only 38.15%, even though it improves from 9.69%. These examples remain in all aggregate scores.

## Secondary: original12 after development

These takes were examined after the first evaluation and motivated the generic correction. They are not a second blind accuracy claim. First-v2 is the earlier `c6e3ba06…` production candidate. Baseline and first-v2 raw predictions are reused unchanged; final is the only rerun on this cohort.

| Reference | Metric | Baseline | First-v2 | Final | Final − first (pp) | Denominator (s) |
|---|---|---:|---:|---:|---:|---:|
| instructed | Exact root/formula | 65.67% | 52.24% | 53.17% | +0.94 | 379.076400 |
| instructed | Root only | 72.47% | 77.61% | 77.61% | +0.00 | 379.076400 |
| instructed | Major/minor projection | 72.80% | 67.76% | 71.04% | +3.28 | 363.301603 |
| instructed | Pitch-class Jaccard | 79.06% | 78.57% | 79.17% | +0.60 | 379.076400 |
| performed | Exact root/formula | 49.96% | 57.51% | 58.44% | +0.94 | 379.076400 |
| performed | Root only | 72.47% | 77.61% | 77.61% | +0.00 | 379.076400 |
| performed | Major/minor projection | 86.64% | 81.26% | 85.75% | +4.49 | 265.289319 |
| performed | Pitch-class Jaccard | 78.38% | 83.52% | 84.10% | +0.57 | 379.076400 |

All 379.076400 known reference seconds are retained; reference X/N and gaps are zero. Missing prediction time is 0.000136 seconds per engine from endpoint rounding. The projection excludes 15.774797 instructed seconds and 113.787081 performed seconds. All old 12 per-clip values, including remaining declines against the original baseline, are retained in summary.json.

Only three old takes have changed metric values against first-v2. Root agreement is unchanged on every take:

| Take | Instructed exact Δ | Performed exact Δ | Instructed projection Δ | Performed projection Δ | Instructed Jaccard Δ | Performed Jaccard Δ |
|---|---:|---:|---:|---:|---:|---:|
| 01_SS1-68-E_comp | +0.00 | +0.00 | +0.00 | +0.00 | -0.08 | -0.08 |
| 02_Funk1-97-C_comp | +0.00 | +0.00 | +15.74 | +94.41 | +1.31 | +1.31 |
| 03_Rock1-130-A_comp | +16.02 | +16.02 | +32.66 | +32.66 | +8.62 | +8.20 |

The fix improves projection on the weak-third Funk example without making its exact extended chord label correct; exact agreement there is unchanged. The Rock example improves exact agreement. The SS example has a small Jaccard regression, preserved above. No take is removed to improve the report.

## Known full-song development guard: Behind Blue Eyes

The automatic intro remains **Em → G6 → Dsus2 → Cadd9 → Asus2**. The final raw output contains 109 segments over 276.456813 seconds. Root's unchanged raw JSON, Russian timed text, intro excerpt and sequence comparison are in [behind-blue-eyes/](behind-blue-eyes/manifest.json). This known development song is separate from the primary fresh cohort.

| Untimed structural variant | Baseline root edits | First-v2 root edits | Final root edits | Baseline exact edits | First-v2 exact edits | Final exact edits |
|---|---:|---:|---:|---:|---:|---:|
| printed-one-instrumental-cycle | 24 | 4 | 4 | 73 | 66 | 69 |
| two-instrumental-cycles-hypothesis | 21 | 1 | 1 | 74 | 66 | 69 |

Exact root/formula event edits **regress from 66 to 69** against first-v2 for both structures, despite the preserved intro and unchanged root event counts. The two-cycle instrumental interpretation remains a separate hypothesis; it is not selected to maximize a score. The supplied chart has no timings, so these event edit counts are **not whole-song duration accuracy**, and no section or E/Esus4 transition times have been invented. Key and tempo estimates are not validated by this evaluation.

## Execution and integrity

| Cohort / engine | Audio PCM (s) | Executions | Process wall (s) | CLI analysis (s) |
|---|---:|---:|---:|---:|
| fresh-holdout / baseline | 367.9884375 | 12 | 0.756948 | 0.494100 |
| fresh-holdout / candidate | 367.9884375 | 12 | 25.647039 | 25.296629 |
| development-after-evaluation / candidate | 379.0763750 | 12 | 26.612375 | 26.234235 |

These are serial CPU-host measurements including process startup; they are not mobile-device benchmarks. Archived old baseline/first-v2 outputs have no new timing measurement. The standard locked release build passed 31/31 Rust tests (36.5 s test execution); logs and the native build attestation are preserved. Candidate2 was rejected before this fresh run; its separate rejection archive and development-only diagnosis document why the final candidate differs.

- Final binary SHA256: `840356f71e7fdbad4c209b55c234bedc9e97c59b2ca03a0355308334b217e27a`.
- Source bundle SHA256: `04bacdde9d013326157f6b5037fe87106232d234e6720f91a2f44668ba0654eb`.
- Authorized comparison freeze SHA256: `fe223a7191a302321bbbfd31a90bbb249042342ca7805e40310c23cc7e27f4fb`.
- Runner SHA256: `e514e33e062f035f410f120df12e226a43bee3a9a24ed3456aee1434143de8eb`.
- Evaluator SHA256: `c7fb0879858ae5149d10b35d6f05877bcccd2a97a3f4ed5e5a839a03b8bd540e`.
- Model NNEF SHA256: `274e46d8b4eec2d6a9da1d52d60744feb7f7dfdf6207dc12db10f5ddd9f3416f`.

`package-manifest.json` verifies every packaged file, including the parent-prepared BBE subfolder. Original JSON/stdout/stderr and build logs are copied byte-for-byte; `.log` filenames are presented as `.txt` without changing their contents. Absolute paths in raw provenance describe the original scratch run and are not rewritten. No audio, PCM, executable, model binary or source snapshot is included in this documentation package. Source/model hashes and fixture acquisition provenance are retained. The evaluator remains in `scripts/evaluate-offline-chords-extended.py`.

## Limits of this evidence

The new12 are held out from our decoder's current development, not certified unseen by Basic Pitch pretraining. GuitarSet was part of its training data; exact checkpoint track membership has not been established. Each cohort covers six performers and five styles, not twelve independent songs. Instructed and sheet-informed semi-automatic performed references remain separate. No accuracy claim for arbitrary full mixes follows.

GuitarSet contains isolated guitar takes, while a released song can contain vocals, bass, drums and other overlapping instruments. The instructed chords reflect the sheet; the performed chords are sheet-informed semi-automatic annotations based on string-note transcriptions, with their original metadata retained. Rootless voicings and omitted tones can therefore produce high pitch-class similarity despite different annotated roots. These limits do not justify removing difficult takes or reporting one reference as the only truth.

This archive records the frozen outcome and its regressions. It supports the measured improvements above; it does not establish exact chord correctness for arbitrary music or a calibrated confidence probability.
