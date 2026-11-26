# Fresh holdout: input provenance only

This directory packages the sealed selection and acquisition metadata for the
next one-shot evaluation. **It contains no predictions or evaluation results.**
The audio, original JAMS, and PCM remain outside the repository.

- Seed: `freetune-chords-second-holdout-2026-11-26`.
- Twelve comp recordings: two different styles for each of six players.
- Style totals: BN 2, Funk 2, Jazz 3, Rock 2, SS 3.
- All original 12 evaluated recordings, the original development clip, and the
  two previously known annotation-timing exclusions are excluded.
- The selection was sealed before media acquisition or inference. Chord labels,
  omitted roots, complexity, and model results did not influence selection.

[selection.json](selection.json) records the complete deterministic SHA-256
ranking and constrained-selection algorithm, eligible IDs, exclusions, seed,
quotas, and preparation-source hashes. Its SHA-256 is:

`509037740ca700b9e3c08cef7687acb288a43a3b0f859204a254865913aca159`

[acquisition-manifest.json](acquisition-manifest.json) pins 12 WAV files,
12 JAMS files, and 12 mono 16 kHz PCM16LE files, totaling 367.9884375 seconds of
PCM, with SHA-256, byte sizes, ZIP CRCs, source URLs, and FFmpeg provenance.
Its SHA-256 is:

`447f47970e82fb3ea2a6f0e4a6ac1ad45330552ebf2819c54f0e1b7edb7a18d2`

[verification.json](verification.json) records the successful 36-file check.
[source-provenance.json](source-provenance.json) identifies the unchanged fetch
helper and the original selection, whose 12 recordings are now explicitly
development-after-evaluation.

Freeze the next candidate before evaluating these inputs. Report all 12 without
post-result removal or replacement, with instructed/performed references and
metric denominators separate. This is a recording-level holdout from decoder
development, not evidence that the recordings were absent from pretrained-model
training. Once results inform another fix, label this set development too.

The four source JSON files are unmodified copies. Their hashes and original
paths are listed in [package-manifest.json](package-manifest.json); this README
is separately identified as packaging metadata.
