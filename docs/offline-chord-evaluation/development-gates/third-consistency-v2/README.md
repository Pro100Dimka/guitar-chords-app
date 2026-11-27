# Rejected development gate: third-consistency-v2

**Status: rejected before any evaluation on the fresh second holdout. This is
candidate2, not the final candidate.** The next candidate must pass the known
development checks before a new frozen SHA can authorize the one fresh run.

The immutable build snapshot passed 29 Rust tests, but its full-context Behind
Blue Eyes development run regressed the intro. The retained raw prediction and
run metadata report `introGatePassed: false`. No fresh-holdout accuracy results
exist for this candidate. The raw freeze status describes when the build was
captured; it does not override this later rejection.

## Observed intro regression

These intervals compare the retained candidate1 and candidate2 predictions.
They are not independently timed chord ground truth; the user-supplied chord
chart is untimed and cannot establish whole-song duration accuracy.

| Previous candidate1 output | Candidate2 output | Consequence |
|---|---|---|
| Dsus2, 4.576–8.480 s | D5, 4.576–5.407891 s; then Dsus2, 5.407891–8.480 s | An arpeggiated chord was split, introducing a power-chord prefix. |
| Asus2, 12.448–15.968 s | A5, 12.448–12.966712 s; then Amadd9, 12.966712–15.968 s | A stable suspension was replaced by a power prefix and a minor-added-ninth label. |

The opening Em (0.288–2.464 s), G6 (2.464–4.576 s), and Cadd9
(8.480–12.448 s) remained unchanged. Candidate2 emitted 116 segments over
276.456813 seconds of audio. N means undetermined/no reliable chord; it does
not prove silence or absence of harmony.

The run took 18.375610 seconds of process wall time; the CLI reported
18341.715 ms. These are CPU-host development measurements, not phone benchmarks.
The recording was already used for development and this was not a blind test.

## Provenance

- Candidate ID: `third-consistency-v2`.
- Binary SHA256: `015894ac74c96bdc804c3fe1ce4269acd541c9952f44e34f285cd3cad7345a03`.
- Source bundle SHA256: `ce3451f32b9a7a9a9470521bbf271115a4fa0c520b5835b194b0e8d9a5120527`.
- Original freeze JSON SHA256: `dff62819e11b09efd5534374fb1890ec98bc98488bd76481522766ab43862361`.
- Input PCM SHA256: `2392aa27f470ea9e0c73ce62893b094b70c850ef19e979d9e464a24a9e56be51`.
- Raw output SHA256: `72a874d41993f848c6659a724d08f4f63ed5c548b2e3d20d62f12517360c0c62`.

The six files copied from the original candidate snapshot are byte-for-byte
unchanged. `package-manifest.json` records the source-relative paths, sizes and
SHA256 values, together with this README's checksum. The source freeze records
the standard locked release build, source/model hashes, and the 29/29 test log.

Only small JSON, Markdown and text/log files are packaged here. Audio, PCM,
executables, model binaries and source snapshots are not included. The original
candidate1 evidence, fresh selection/acquisition metadata, and second-runner
remain unchanged. This rejection is retained as part of the development history;
it must not be represented as a final model result or fresh-holdout evaluation.
