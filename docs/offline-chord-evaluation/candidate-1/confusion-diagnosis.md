# Diagnosis of the frozen production comparison

This is a post-evaluation audit of interval intersections, not a new model run.
The original full-timeline scores and all twelve clips remain unchanged. No
decoder parameters, references or predictions were changed.

## What caused the regression

Performed exact recognition gains 50.9093 seconds that baseline missed, but
loses 22.3189 seconds that baseline got right: net +28.5904 seconds, or +7.5421
percentage points. **17.1303 seconds (76.75%) of the newly wrong performed time
are major/minor chords losing their third and becoming power/sus chords.**
New wrong-root time contributes 3.7457 seconds; added notes 0.8877 seconds;
undetermined N 0.2796 seconds; major/minor-third flips 0.2756 seconds.

Instructed exact loses 70.5665 previously correct seconds while recovering
19.6571 previously wrong seconds: net -50.9094 seconds. Its newly wrong time is
30.0118 seconds of additional notes, 28.9827 seconds of lost thirds, 9.0812
seconds of wrong roots, and 2.4909 seconds of other changes/N.

Of those 70.5665 newly wrong instructed seconds, 17.6528 exactly match the
performed annotation; 52.9137 disagree with both. Therefore reference differences
explain part, but not all, of the instructed regression.

## Five largest error types by performed-reference duration

The groups below are disjoint. Durations include existing errors as well as new
regressions. Inversion bass is ignored, following the frozen metric definition.

| Type | Performed duration | Instructed duration in the same type | Concrete reference → prediction |
|---|---:|---:|---|
| Wrong root | 84.5707 s | 84.5707 s | A#hdim7 → C#m6: 7.0677 s; G:min9(*1) → A#maj7: 6.8232 s; G:7(*1) → Bdim: 4.6720 s; C:maj7(*1) → Em: 4.6400 s |
| Inserted third where reference has none | 22.0116 s | 0 s | C:sus4 → C7: 9.6960 s; D#:sus2(7) → D#maj7: 5.1912 s; F power chord → F major: 4.9485 s |
| Lost third / power-or-suspension substitution | 18.1758 s | 36.0378 s | C major → C5: 4.6720 s performed; A major → Asus4: 3.6857 s; A major → A5: 3.5471 s |
| Missing extensions or other notes, retaining the root/third class | 11.5652 s | 2.1051 s | B:maj(11) → B: 3.2640 s; B:min(4) → Bm: 1.9111 s; D#:sus2(7) → D#sus2: 1.8808 s |
| Other substitution of extension/omission formulas | 11.4376 s | 2.8849 s | D:9(#9,*5) → Dm7: 2.0168 s; G#:maj6(2,b5,*5) → G#maj7: 1.5487 s; C#:min9(*5) → C#madd9: 1.3297 s |

Remaining performed errors: same-root additional notes 10.6408 s; changed
major/minor third 2.3906 s; N 0.2917 s; prediction endpoint gap 0.000136 s.
N means undetermined/no reliable chord; it does not prove silence or absence
of harmony. Unsupported reference formulas remain in the exact denominator.

### Expected extensions versus the simple sheet

There are 45.0878 seconds where production retains the instructed root and all
instructed notes but adds notes. Of these, 19.8443 seconds exactly match the
performed formula, while 25.2435 seconds still disagree with performed. Examples
of the sheet comparisons are C major → C7 (9.6960 s), D# major → D#maj7
(8.9121 s), and B major → Bmaj7 (7.2313 s). The C7 case is not validated by the
performed reference: it says Csus4 over that time.

Among **newly introduced** instructed errors from added notes, 12.0911 of
30.0118 seconds are correct according to performed. These are not counted as
performed regressions. Major/minor projection remains separately denominated;
it cannot substitute for exact extended-chord accuracy.

## Root failures: ambiguity, transposition and timing

Wrong-root predictions occupy 84.5707 seconds. Of these, **27.7189 seconds have
exactly the same absolute pitch-class set as the performed reference**, with a
different root interpretation. For example:

- A#hdim7 and C#m6 both contain A#, C#, E, G#.
- C:maj7(*1) contains E, G, B, exactly an Em triad.
- G:7(*1) contains B, D, F, exactly a Bdim triad.
- G:min9(*1) contains A#, D, F, A, exactly A#maj7.

These still count wrong under the frozen root/formula criterion. They are not
silently relabeled as successes. Across all twelve clips, the performed reference
explicitly omits its root for 28.7073 seconds; production has a wrong root on
25.3728 seconds of that duration.

The two weakest root clips contribute 48.0542 of the 84.5707 wrong-root seconds:
04_Funk2-119-G_comp contributes 25.3982 s, and 03_Jazz3-150-C_comp 22.6560 s.

### No evidence for a common capo/transposition correction

For both weak clips and both engines, **zero transposition maximizes performed
pitch-class Jaccard** over the twelve possible uniform semitone shifts.

| Production clip | Original root / pitch-set similarity | Shift that maximizes roots | Root score after that shift | Pitch-set similarity after that shift |
|---|---|---:|---:|---:|
| 03_Jazz3 | 11.50% / 67.6820% | +8 semitones to every prediction | 47.75% | 17.2339% |
| 04_Funk2 | 21.2779% / 68.1875% | +9 semitones | 42.8449% | 21.1607% |

Those shifts preferentially rename chord thirds as reference roots while
destroying agreement with the actual pitch-class formulas. They are not useful
evidence of a uniformly transposed recording. No transposition was applied.

### No evidence for a large common timing error or a local file swap

A descriptive shift search from -4 to +4 seconds in 20 ms increments keeps the
whole original timeline in the denominator. The best production pitch-set
alignment is -20 ms for Jazz (67.6922%, just +0.0102 percentage points) and 0 ms
for Funk. Baseline optima are 0 ms and -20 ms respectively. A large shift does
not repair these clips. These post-hoc maxima are not replacement scores.

Both original WAV hashes match the acquired ZIP-member records. Their archive
member names, JAMS titles and annotation-member names match the selected takes.
Jazz WAV duration is 25.6000000 s versus reference 25.6000000 s; Funk WAV duration
is 32.2631973 s versus reference 32.2632000 s. This rules out a local acquisition
or pairing mismatch in the checked files, but does not certify every upstream
annotation.

Jazz explicitly has omitted-root labels for 19.2 of 25.6 seconds. Its first
performed chord is C:maj7(*1), and the string-note annotations contain only
G3/B3/E4 during that chord (0.7605/0.6037/0.6444 note-seconds), consistent with
the predicted Em interpretation. Funk's first Cm7 reference has only 0.3251
note-seconds of C3, versus 0.5631 of A#3, 0.7314 of D#4 and 0.9810 of G4;
the independently present bass is much less persistent than the upper voicing.
Those are annotation observations, not new neural outputs or acoustic proof.

## Artifacts and limits

- `confusion-diagnosis.json`: full category totals, concrete pairs, new-error
  contributions and root ambiguity counts.
- `confusion-intervals.json`: the original atomic interval intersections.
- `low-root-fixture-audit.json`: verified pairing metadata and complete
  transposition/time-shift diagnostic curves.
- `summary.json` and `comparison.json`: unchanged original metrics.

The original training-overlap caveat remains: the twelve takes were held out
from our decoder tuning, but are not certified absent from Basic Pitch training.
No model changes followed this evaluation. If these results guide subsequent
algorithm changes, this set must be described as development-after-evaluation
and any new heldout claim needs a fresh preselected evaluation set.
