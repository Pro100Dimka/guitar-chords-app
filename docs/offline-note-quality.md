# Real-audio note and tablature diagnostic

This diagnostic checks the actual production path from decoded audio to native
note events, playing-style output and proposed guitar tabs. It runs inside the
ready-PR/main native workflow, reusing its already built `chord_probe`. It adds
no app model or dependency and does not run on ordinary branch pushes or draft
PRs.

## Fixed input and scope

The input is the full **39.178798-second** GuitarSet 1.1.0 take
`00_SS3-98-C_comp`, a recorded acoustic-guitar performance. It is the existing
development example already used for chord analysis, not a newly held-out song.
The existing [fixture manifest](offline-chord-analysis-fixtures.json) pins the
WAV and JAMS archive members, byte counts and SHA-256 hashes. Acquisition uses
bounded HTTP Range requests to the official Zenodo archives. Audio is not added
to the repository, application or uploaded diagnostic artifacts.

Credit: Qingyang Xi, Rachel M. Bittner, Johan Pauwels, Xuzhou Ye and Juan P. Bello,
_GuitarSet: A Dataset for Guitar Transcription_, ISMIR 2018. Dataset license:
CC-BY-4.0. [Dataset](https://zenodo.org/records/3371780) and
[authors' repository](https://github.com/marl/GuitarSet).

The JAMS file supplies six `note_midi` annotations, identified by string indices
0–5, containing **271 notes** in total. Their published fractional MIDI values
and times are used without correction. Notes per string, low to high: 30, 41,
75, 40, 51 and 34. These are pickup-derived published annotations, not a new
independent manual transcription. The selected take is not among the files named
in the dataset's known [timing](https://github.com/marl/GuitarSet/issues/5) and
[duplicate-note](https://github.com/marl/GuitarSet/issues/4) issues.

One previously used take cannot establish accuracy across performers, styles,
full mixes or unfamiliar songs. GuitarSet was also used in Basic Pitch training;
exact checkpoint track overlap is unverified. Any diagnosis or tuning on this
example remains development work. The source genre and `comp`/`solo` mode do not
provide strumming, picking or stroke-direction labels.

## What is measured

The primary report includes every reference note and every native prediction.
It does not fit a time shift, crop difficult passages, filter a register,
collapse duplicate predictions, use the reference tempo or substitute a chord
sheet for detected notes.

Two separate maximum-cardinality one-to-one matchings are computed:

| Criterion                      | Allowed difference                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Pitch and attack time          | ±0.5 MIDI semitone and ±50 ms                                                                    |
| Pitch, attack and release time | The same limits, plus release error within the larger of 50 ms and 20% of the reference duration |

Precision, recall, F1, matches, false positives and false negatives all retain
their explicit counts. The criteria follow the common note-transcription
definitions documented by [mir_eval](https://mir-eval.readthedocs.io/latest/api/transcription.html).
This standard-library implementation uses raw fractional reference MIDI and
inclusive comparisons with a 1e-9 arithmetic epsilon. It is not advertised as
byte-identical to an external evaluation implementation. Semantic tests cover
augmenting paths that greedy matching misses, duplicates, unisons, octave errors,
tolerance boundaries, note endings and empty predictions.

Signed and absolute onset, offset and duration errors are reported for the
deterministic onset/pitch matching. That matching maximizes the number of
matches, not timing quality. Confirmed-onset and activity-only subsets are shown
as additional diagnostics with the same complete reference denominator; they
do not replace the all-event score.

## Production tabs and style

`inspect-audio-performance.cjs` loads the existing TypeScript validator,
`analyzeAudioRhythm` and `projectAudioTablature`, rather than implementing another
version. The selected range is the whole native recording. The production tempo
estimate initializes the layout, or the app's explicit 80 BPM fallback when it
is unknown. No reference information is available to this runner.

Actual emitted tab notes are converted back to seconds using the emitted tempo,
ticks per quarter note and source offset, then scored against the same full
reference. The report includes source-note count, placed-note count, projection
losses and clipping. An unavailable projection receives zero matches, preserving
the complete reference denominator.

Recorded-string agreement is a separate diagnostic. Several playable fingerings
can produce the same pitch, and simultaneous unisons may originate on different
strings; agreement is not required for pitch correctness. The report explicitly
leaves playing-style accuracy unset because there are no technique labels. The
estimated style and its sections remain visible for inspection.

## Evidence and reproduction

The `Real guitar note and tablature diagnostic` step performs the following in
the ready PR or main workflow:

1. Run the evaluator's semantic tests and fetch/verify the pinned WAV and JAMS.
2. Decode the complete WAV to mono 16 kHz PCM16LE and record the FFmpeg version.
3. Run the production native probe and retain its complete unchanged JSON.
4. Run production JS style/tab post-processing and score both outputs.
5. Upload `native.json`, `performance.json`, `report.json` and
   `decoder-version.txt` as the `offline-note-quality` artifact.

The report includes reference, source-audio, PCM, native executable, prediction,
post-processing source and evaluator hashes, plus runtime and GitHub run metadata.
Its full JSON is also delimited by `NOTE_QUALITY_REPORT_BEGIN` and
`NOTE_QUALITY_REPORT_END` in the job log. Artifact retention is 30 days; job-log
retention follows the repository's policy. The raw outputs and hashes allow a
result to be attributed to a specific run rather than to whichever code is now
on the branch.

The workflow's native duration measures processing of already decoded PCM; JS
timings are a single Linux/Node post-processing pass. Neither is phone latency.
No accuracy threshold is selected after seeing a score to turn the diagnostic
green. A successful diagnostic means the pinned input was processed and scored
under this protocol, not that the transcription reached professional quality.
