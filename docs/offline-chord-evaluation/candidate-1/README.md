# Candidate 1: historical first blind evaluation

This directory preserves the first evaluation of the frozen production candidate
with binary SHA-256:

`c6e3ba0623c08c1be73b605b0380e523349942978981c557ec271c0a63ef90bf`

The original 12 GuitarSet recordings were held out from decoder tuning when this
evaluation was run. Their results and the subsequent diagnoses then informed
further fixes. **These recordings are now development-after-evaluation.** Later
scores on them are development checks, not another blind evaluation.

The final candidate and its fresh 12-recording evaluation will be recorded
separately. The sibling `fresh-holdout` directory contains input provenance only.
No result in this historical package should be presented as the final candidate's
performance or as proof that GuitarSet was absent from pretrained-model training.

## Contents

- [summary.md](summary.md), [summary.json](summary.json), and
  [comparison.json](comparison.json): original aggregates, every clip, explicit
  denominators, and regressions. Instructed and performed references remain
  separate.
- `baseline/outputs/` and `candidate/outputs/`: unchanged raw outputs for all 12
  recordings and the complete Behind Blue Eyes recording, for both engines.
- [behind-blue-eyes-detected-chords.txt](behind-blue-eyes-detected-chords.txt)
  and [behind-blue-eyes-sequence.json](behind-blue-eyes-sequence.json): the full
  timestamped candidate output and ordered event comparisons. The supplied song
  reference was untimed; edit counts are not duration-weighted accuracy.
- [production-freeze.json](production-freeze.json): the evaluator's frozen
  `candidate/freeze.json`, copied under an explicit package filename.
  `baseline/frozen-manifest.json`, `evaluation-inputs/`, `inputs.json`,
  `runs.json`, `completion.json`, and `reference-coverage.json` retain provenance.
- [confusion-diagnosis.md](confusion-diagnosis.md),
  [confusion-diagnosis.json](confusion-diagnosis.json), and
  [third-loss-diagnosis.json](third-loss-diagnosis.json): post-evaluation
  diagnoses. These diagnoses explain why the original set became development
  material; they are not additional blind results.
- `memory-900s/`: input provenance, GNU time metrics, run summary, empty stderr,
  and the complete 423-segment output from one maximum-duration run of the same
  frozen binary. The observed peak RSS was 86,968 KiB; host timings are not phone
  timings or a proof of memory scaling across repeated runs.

## Historical wording and integrity

Copied reports retain their original bytes, including statements such as
"No post-evaluation tuning was performed." Those statements describe the moment
of the first evaluation. The subsequent status is the development designation
above; the historical reports have not been rewritten to conceal chronology.

Only JSON, Markdown, and text evidence is included. Audio, PCM, original JAMS,
NPZ tensors, executables, and source-tree snapshots are excluded. Historical
absolute scratch paths remain provenance references, not bundled dependencies.

[package-manifest.json](package-manifest.json) records each copied source path,
byte count, and SHA-256. Every copied file was checked byte-for-byte by hash
against its source; this README is identified separately as packaging metadata.
