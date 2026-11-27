# Inspect a predicted chord section

The developer command reads an existing **full-recording prediction JSON** and
shows a selected interval with absolute timestamps. It does not cut audio or run
the recognizer again. Thus inspecting a passage preserves whatever surrounding
context the original analysis used. The tool does not verify how that upstream
prediction was generated.

```sh
python3 scripts/inspect-offline-chord-section.py /tmp/prediction.json \
  --start 0 --end 0:16
python3 scripts/inspect-offline-chord-section.py /tmp/prediction.json \
  --start 12.5 --end 22.5 --reference /tmp/reference.jams \
  --json /tmp/section-report.json
python3 scripts/test-offline-chord-section.py
```

`--start` and `--end` accept seconds or `MM:SS.sss`. The interval is half-open:
the start is included and the end excluded. It must be nonempty and within the
prediction's recording duration. A `*` in the text marks a chord clipped at the
selection boundary. JSON retains both the displayed times and original source
boundaries; clipping does not create a new detected chord change.

Use `--json` without a path to print JSON instead of text. With a path, the
command writes JSON there and prints the readable report. Input hashes and the
evaluator hash are recorded. No audio or lyrics are copied into the report.

Without a timed reference, the report contains **raw predictions only** and no
accuracy score. An untimed song chart is not a substitute for timestamped truth.
`N` is displayed as undetermined/no chord, while gaps are explicitly marked as
missing predictions.

For example, selecting `0:12.50`–`0:22.50` from the retained
[Behind Blue Eyes prediction](offline-chord-evaluation/candidate-final/behind-blue-eyes/output.json)
produces this display (hundredths of a second):

| Recording time | Existing prediction |
| --- | --- |
| 0:12.50–0:15.97 | Asus2 * |
| 0:15.97–0:18.40 | Em |
| 0:18.40–0:20.45 | G6 |
| 0:20.45–0:21.40 | Dm |
| 0:21.40–0:22.50 | Dadd9 * |

The first source interval starts at 12.448 seconds; the last ends at 23.483719
seconds. Only the displayed selection is clipped. **The known formula errors
`Dm` / `Dadd9` remain unchanged**; this example demonstrates interval inspection,
not improved recognition or a new audio run.

The optional reference is a GuitarSet-format JAMS containing exactly two chord
annotations in the dataset's order: instructed, then performed. The command
uses the existing extended evaluator's chord parsing and score definitions.
It validates the entire input before clipping, so an invalid interval outside
the selected passage is still an error. Full-file prediction/reference durations
must agree within the evaluator's 20 ms tolerance.

Each role reports exact root/formula agreement, root agreement, major/minor
projection, and pitch-class Jaccard separately. Scores use the full selected
annotated duration, with **no boundary trimming**. Reference `X` is excluded and
reported; unannotated reference gaps are separately reported because they supply
no truth. Missing predictions and predicted `X` count wrong on known reference
time. Reference `N` remains known and only matches predicted `N`. Major/minor
projection has its own explicit denominator. Equal pitch sets do not make
different roots equivalent.

Selected-section scores are diagnostic, not whole-song accuracy or a new held-out
evaluation. Choosing a passage after seeing its mistakes makes it development
evidence. The app also has a [section selector](offline-chord-analysis.md#review-a-selected-passage)
for inspection and editor import, without reference scores. Neither that selector
nor this command implements strumming classification, rhythm transcription,
guitar separation, or tablature.
