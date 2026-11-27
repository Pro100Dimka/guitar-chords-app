# Playing style and tabs from local audio

The existing **Chords from audio** screen now uses the bundled note model for
three linked outputs: the chord timeline, estimated playing style and an editable
guitar tablature. All processing stays on the device. No new model, dependency,
server call or song-specific rule is introduced.

## User flow

1. Analyze a local audio file and apply either the full duration or a passage.
2. Review the estimated style: strumming, picking, mixed or undetermined. The
   attack preview shows detected pitch groups at absolute recording times.
3. Review the proposed note counts and tempo, then create the tabs. The full-file
   tempo estimate is used when available; otherwise the clearly labeled 80 BPM
   default supplies a layout. Tempo can be edited before generating the tabs.
4. Edit and play the tabs in an isolated session of the existing editor. Closing
   the window preserves edits. Leaving the screen stops instrument playback.
5. Open the song form with the current edited tabs and timestamped chord chart,
   then save through the existing song-storage path.

Changing the file or applied range, regenerating tabs, or removing the analysis
screen asks before discarding manually edited tabs. Confirmation callbacks are
bound to the current result, range, tempo, session and navigation context. A
cancelled or failed file import retains the old result. The existing Play working
copy is neither loaded nor overwritten by this isolated editor.

The chart keeps absolute recording times. Tab tick zero corresponds to the
selected passage's start; the exported notice records that offset. Detected notes
can be saved even when the chord result is entirely undetermined. File names are
only editable titles and never inputs to the audio algorithms.

## Note events

`android/song-fingerprint/src/note_events.rs` decodes the existing Basic Pitch
note and onset frames. It uses actual frame start/end times, including model
window seams, activity hysteresis, minimum supported duration and local onset
peaks. A supported repeated onset splits a sustained pitch into separate notes.
Strong activity without an independently supported onset can remain a note with
zero onset evidence; it does not become a claimed new attack.

The native JSON extension contains:

| Field                   | Meaning                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `noteEventsVersion`     | `1`                                                              |
| `noteEventsLimit`       | `24000`                                                          |
| `noteEventsTruncated`   | Whether accepted events exceeded the cap                         |
| `noteEventsCoverageEnd` | Absolute time before which every decoded attack is retained      |
| `noteEvents`            | Sorted `{start, end, midi, noteEvidence, onsetEvidence}` objects |

MIDI pitches are 21–108. Times are rounded to six decimals before ordering and
capping. Equal-pitch intervals do not overlap; different pitches may overlap.
Evidence values are model activity, not calibrated probabilities, velocity or
playing intensity. The earliest 24,000 events are retained across all pitches.
If the cap is reached, its boundary is the earliest discarded attack, including
ties; an analysis beyond that complete prefix is unavailable, not silence.

The Android bridge explicitly carries this metadata; iOS passes through the
shared core's JSON. The TypeScript validator rejects partial, malformed,
unsorted, overlapping or inconsistent extensions. Older chord-only responses
remain usable and are distinct from a complete empty note transcription.

## Estimated playing style

`audio-rhythm.ts` groups supported attacks in the standard guitar register
(MIDI 40–88) within 70 ms of the first attack. A repeated pitch starts another
group. Groups of at least three pitches spanning seven semitones supply chord
attack evidence. Successive single-pitch attacks on different ringing notes
across at least three pitch classes supply picking evidence. A monophonic melody
alone does not qualify as a picking pattern. Sparse or conflicting evidence
returns undetermined.

Grouping happens on the original timeline before selection, so cutting through
a strum cannot invent a picking sequence. Only groups fully inside the outer
selection are returned. Internal four-second classification windows assign
intact groups by their first attack, then merge adjacent equal labels; these
windows are onset-anchored context, not independently re-analyzed clips.
Ringing support is clipped to the analyzed end. Incomplete attack groups near a
truncated native prefix are excluded. The overall label is duration-weighted,
including undetermined time.

These are conservative, untrained texture heuristics. The system does not
identify the original player's hand, fingers, up/down stroke direction, musical
meter or downbeat. Register filtering is not source separation: voices and other
instruments in a mix can produce misleading notes and attacks. Basic Pitch is
[instrument-agnostic and works best on one instrument at a time](https://github.com/spotify/basic-pitch).
The UI presents an estimate and never fills a `SongRhythm` preset from it.

## Note-to-tab projection

`audio-tablature.ts` places actual detected notes onto six strings in standard
EADGBE tuning, frets 0–24. A bounded beam search favors more placed notes, then
supported notes and comfortable positions. It enforces one active note per
string, a four-finger/barre feasibility rule and a maximum four-fret span.
It does not shorten a sounding note to make room for another one. Notes the
search cannot place are reported; this is not proof that no fingering exists.

Durations and attack times are converted to the editor's 24-tick quarter-note
timeline using the chosen integer tempo, with 1/960-tick storage precision.
There is no forced beat quantization. The initial 4/4 meter is a layout assumption,
not a detected meter or bar alignment. Original string choice is ambiguous from
pitch alone, so every resulting fingering remains editable. Fixed playback
velocity is a preview default, not recovered dynamics. No picking direction,
legato, slide, bend or other technique is fabricated.

The preview and exported notice distinguish:

- placed notes;
- notes outside the supported guitar range;
- notes the bounded placement search could not assign;
- placed notes already sounding when the selected passage starts;
- placed notes whose ends are cut by the passage boundary.

The last two counts describe clipping, not dropped notes. The first three sum
to the selected-note count. A final normalization comparison prevents silent
note loss, deduplication or sustain shortening by the existing editor format.

One projection accepts at most 2,048 candidate guitar notes and 128 layout bars.
These import budgets do not grow when the editor's own capacity increases; a
smaller editor capacity also bounds the importer. Larger requests explicitly
ask for a shorter passage. The native note output
cap, full-file 15-minute limit and existing editor content limit also apply. The
algorithm does not silently crop a long performance to make it fit.

## Validation status

This implementation has been reviewed statically across native decoding, bridge
mapping, contract validation, style classification, placement and editor handoff.
New tests cover synthetic frame timing, repeated attacks, release gaps, event
caps, legacy/invalid wire data, grouped attacks, selection boundaries, monophonic
counterexamples, string conflicts, playable shapes, explicit limits, edit
preservation, stale confirmations and real editor transport wiring. The existing
iOS WAV/AAC decoding regression now also checks the production note-event schema.

Tests are authored for the ready-PR checks. No local build, compilation, test or
inference run was performed for this change, following the project's
[CI policy](ci-policy.md). A passing CI run establishes the tested contracts and
regressions; synthetic fixtures and decoder integration do not establish
transcription accuracy on real music.

There is no measured note/style/tab accuracy, phone timing or memory delta for
this new post-processing yet. The historical chord benchmark and Behind Blue
Eyes chord output in [offline-chord-analysis.md](offline-chord-analysis.md) remain
attached to their original frozen executable. They are not evidence for the new
tabs or playing-style estimate, and their labels were not used to generate notes.
