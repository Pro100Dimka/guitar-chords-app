# Frozen production comparison

Mixed result: performed exact/root/pitch-class similarity improved, instructed exact and both major/minor projections regressed. This does not establish professional-quality recognition of arbitrary songs.

## Full-timeline GuitarSet metrics

| Reference | Metric | Baseline | Production | Change (pp) | Denominator (s) |
|---|---|---:|---:|---:|---:|
| instructed | Exact root/formula | 65.67% | 52.24% | -13.43 | 379.0764 |
| instructed | Root only | 72.47% | 77.61% | +5.14 | 379.0764 |
| instructed | Major/minor projection | 72.80% | 67.76% | -5.04 | 363.3016 |
| instructed | Pitch-class Jaccard | 79.06% | 78.57% | -0.49 | 379.0764 |
| performed | Exact root/formula | 49.96% | 57.51% | +7.54 | 379.0764 |
| performed | Root only | 72.47% | 77.61% | +5.14 | 379.0764 |
| performed | Major/minor projection | 86.64% | 81.26% | -5.38 | 265.2893 |
| performed | Pitch-class Jaccard | 78.38% | 83.52% | +5.14 | 379.0764 |

Exact/root/Jaccard retain all 379.0764 reference seconds. X exclusions: 0. All reference timelines are continuous; N duration: 0. Missing prediction time is 0.000136 seconds for both engines, from endpoint rounding. Unsupported model formulas are not excluded. The projection denominators differ explicitly.

## Every clip, including regressions

Values are baseline → production; changes are percentage points.

| Clip | Instructed exact | Performed exact | Root only (both references) |
|---|---:|---:|---:|
| 00_BN1-129-Eb_comp | 59.22 → 6.63 (-52.59) | 4.62 → 23.30 (+18.67) | 59.22 → 78.03 (+18.81) |
| 00_Rock3-117-Bb_comp | 95.81 → 80.35 (-15.46) | 84.10 → 74.67 (-9.44) | 95.81 → 95.13 (-0.69) |
| 01_SS1-68-E_comp | 98.46 → 92.70 (-5.76) | 90.55 → 84.99 (-5.56) | 98.46 → 98.40 (-0.06) |
| 01_Jazz2-110-Bb_comp | 55.19 → 68.29 (+13.10) | 45.47 → 92.09 (+46.61) | 90.73 → 92.14 (+1.41) |
| 02_Funk1-97-C_comp | 68.34 → 16.67 (-51.67) | 16.07 → 22.82 (+6.75) | 83.34 → 95.47 (+12.14) |
| 02_BN3-119-G_comp | 92.11 → 87.25 (-4.86) | 80.80 → 81.32 (+0.52) | 92.11 → 93.38 (+1.27) |
| 03_Rock1-130-A_comp | 95.74 → 41.86 (-53.89) | 70.74 → 51.60 (-19.14) | 95.74 → 87.66 (-8.08) |
| 03_Jazz3-150-C_comp | 11.00 → 0.00 (-11.00) | 0.00 → 0.00 (+0.00) | 13.12 → 11.50 (-1.63) |
| 04_SS2-107-Ab_comp | 37.12 → 53.31 (+16.18) | 36.92 → 65.25 (+28.33) | 59.41 → 72.41 (+13.01) |
| 04_Funk2-119-G_comp | 9.07 → 3.29 (-5.78) | 6.17 → 5.85 (-0.33) | 9.07 → 21.28 (+12.21) |
| 05_BN2-166-Ab_comp | 35.55 → 4.68 (-30.87) | 0.00 → 30.17 (+30.17) | 37.32 → 57.24 (+19.92) |
| 05_SS3-84-Bb_comp | 98.03 → 95.03 (-3.00) | 98.03 → 95.03 (-3.00) | 98.03 → 98.07 (+0.04) |

All per-clip metric values and every negative delta, including projection and Jaccard, are retained in summary.json. No clip was removed after seeing its results.

## Behind Blue Eyes

Automatic intro: **Em → G6 → Dsus2 → Cadd9 → Asus2**. There are 110 raw segments over 276.456813 seconds, including initial/final N.

| Structural variant | Baseline root edits | Production root edits | Baseline exact edits | Production exact edits |
|---|---:|---:|---:|---:|
| printed-one-instrumental-cycle | 24 | 4 | 73 | 66 |
| two-instrumental-cycles-hypothesis | 21 | 1 | 74 | 66 |

These are unit-cost ordered event edit counts, not duration-weighted accuracy. Counts describe one optimal alignment; no best structural variant is selected. Root-only sequences additionally merge consecutive equal roots.

Later qualities remain wrong against the supplied chord order: for example the first verse contains G instead of G6, and a Dm → Dadd9 → D6 sequence where the printed cycle has Dsus2. These are qualitative observations, not invented timed ground-truth intervals. The complete automatic timestamped output is in behind-blue-eyes-detected-chords.txt and unchanged raw JSON.

## Host timing and provenance

The 12 clips took 27.084 s process wall time for 379.076376 s audio. Full BBE took 18.431 s wall time; CLI elapsedMs was 18398.856. These are CPU-host measurements, not device performance.

Binary SHA256: `c6e3ba0623c08c1be73b605b0380e523349942978981c557ec271c0a63ef90bf`.

Source bundle SHA256: `757b24fe28ea1c40e44028427a8cd6db9a50badbf1426f9906c899d5eb469b2a`.

Freeze manifest SHA256: `df569e59acfe00e2971fa4b4eeb6ec0235263e8c967d30d1c2c59ca5681f4a1f`.

These 12 GuitarSet takes were held out from our decoder tuning. They are not certified unseen by the pretrained Basic Pitch model: GuitarSet was a training dataset and this checkpoint has no verified track-membership manifest here. The takes cover six performers and five styles, not twelve independent songs. Instructed and sheet-informed semi-automatic performed annotations remain separate.

No post-evaluation tuning was performed.
