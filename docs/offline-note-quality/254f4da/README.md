# First production note/tab development measurement

This is the unchanged output of the ready-PR diagnostic for feature head
`254f4da55b4b0e31e5736999f242046ceec768a0`, run on 2026-11-27.
The GitHub PR checkout was `18aff35fa573dcbd1c0427cb7380d902c57a1c97`;
exact executable, input, evaluator and production-source hashes are in
[report.json](report.json). The extracted files are retained byte-for-byte.

[Workflow run](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45922423944)
· [Original artifact](https://github.com/Pro100Dimka/guitar-chords-app/actions/runs/45922423944/artifacts/15165257705)
· [Protocol and limitations](../../offline-note-quality.md)

The downloaded artifact ZIP SHA-256 is
`a1c05b0c4e09188a86e378b1dfb7fa3ae47ec87f53275b704dce140fffd50f64`.
No model, note-decoder or post-processing thresholds were changed after seeing
this result. This is a baseline, not a measured improvement over an earlier
note/tab implementation.

## Input and limits

Full GuitarSet 1.1.0 development take `00_SS3-98-C_comp`: 39.178812 seconds after
PCM decoding, with 271 reference notes. This take was previously used for chord
development. GuitarSet was used in Basic Pitch training; exact checkpoint track
overlap is unverified. One take does not establish performance on other players,
playing styles or full-mix songs.

Source: Qingyang Xi, Rachel M. Bittner, Johan Pauwels, Xuzhou Ye and Juan P. Bello,
_GuitarSet: A Dataset for Guitar Transcription_, ISMIR 2018.
[Official dataset](https://zenodo.org/records/3371780), CC-BY-4.0.
No audio or reference annotation is copied here. Provenance and pinned source
hashes are in the report.

## Complete-reference results

Every metric uses all 271 reference notes, all corresponding output notes,
and maximum one-to-one matching. The pitch/onset criterion allows 50 cents and
50 ms. The stricter criterion also requires the ending within the larger of
50 ms and 20% of the reference duration. No fitted time shift or cropping is used.

| Output and criterion                   | Predictions | Matches | False positives | Missed notes | Precision | Recall |     F1 |
| -------------------------------------- | ----------: | ------: | --------------: | -----------: | --------: | -----: | -----: |
| Native, pitch + onset                  |         403 |     229 |             174 |           42 |    56.82% | 84.50% | 67.95% |
| Native, pitch + onset + offset         |         403 |     125 |             278 |          146 |    31.02% | 46.13% | 37.09% |
| Projected tabs, pitch + onset          |         394 |     226 |             168 |           45 |    57.36% | 83.39% | 67.97% |
| Projected tabs, pitch + onset + offset |         394 |     124 |             270 |          147 |    31.47% | 45.76% | 37.29% |

The projector placed 394 notes and explicitly left 9 unassigned; none were
outside the supported guitar range or clipped by the selected interval.
The onset/pitch match count fell from 229 to 226. The main observed quality
limits are therefore upstream false positives and note endings, with a smaller
additional loss during fingering assignment. This is an inference from this
recording, not a universal attribution of errors.

For the native onset/pitch matches, median absolute onset error is 12.49 ms;
median absolute ending error is 68.69 ms, with a 660.11 ms 90th percentile.
These statistics cover matched notes only and must not hide extra or missed notes.

## Style and runtime diagnostics

The production style result is `undetermined` overall, with `mixed` estimates
for 4–12 and 16–24 seconds. These are algorithm outputs. The reference has no
strumming/picking labels, so style accuracy is explicitly unset.

The native probe took 2,269.956 ms for already decoded PCM on the Linux CI host.
Production JS style analysis took 1.758 ms and note-to-tab projection 47.818 ms.
These are single host measurements, not physical-phone latency or end-to-end
import timing. The detected tempo was 96.91 BPM; the app's rounded 97 BPM layout
was used, without reference tempo input.

The successful diagnostic and 13 evaluator semantic checks do not make the full
workflow green: the application run separately exposed two type-checking issues,
and the Swift job's tests passed before a GitHub artifact-service upload timeout.
Those CI issues and any later reruns must be attributed to their own commits.

## Files

- `native.json`: unchanged native chords/note events and processing time.
- `performance.json`: actual production style and tab output, source hashes and timings.
- `report.json`: complete counts, match indices, timing diagnostics and provenance.
- `decoder-version.txt`: exact FFmpeg build used for the input conversion.
