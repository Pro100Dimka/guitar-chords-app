#!/usr/bin/env python3
"""Score one pinned development recording; no inference, alignment, or tuning.

The input is the production chord_probe JSON, optionally accompanied by the
production JS rhythm/tab runner. GuitarSet note_midi values remain fractional.
This is a standard-library implementation of the declared matching protocol,
not a claim of byte-for-byte equivalence with an external evaluation package.
"""

import argparse
import hashlib
import json
import math
import os
import platform
import statistics
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
MANIFEST = REPO / "docs/offline-chord-analysis-fixtures.json"
FIXTURE_ID = "00_SS3-98-C_comp"
ONSET_TOLERANCE = 0.05
PITCH_TOLERANCE = 0.5
OFFSET_MINIMUM = 0.05
OFFSET_RATIO = 0.2
EPSILON = 1e-9
TUNING = [40, 45, 50, 55, 59, 64]


def finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(label + " must be a finite number")
    return float(value)


def integer(value, label, low, high):
    number = finite(value, label)
    if not number.is_integer() or not low <= number <= high:
        raise ValueError(label + " is outside the integer range")
    return int(number)


def interval(start, end, duration, label, tolerance=0.000001):
    start, end = finite(start, label + " start"), finite(end, label + " end")
    if start < 0 or start >= duration or end <= start or end > duration + tolerance:
        raise ValueError(label + " has an invalid source-time interval")
    return start, end


def reference_notes(jams):
    duration = finite(jams["file_metadata"]["duration"], "Reference duration")
    if duration <= 0:
        raise ValueError("Reference duration must be positive")
    annotations = [item for item in jams["annotations"] if item.get("namespace") == "note_midi"]
    strings, notes = set(), []
    for annotation in annotations:
        source = str(annotation.get("annotation_metadata", {}).get("data_source"))
        if source not in {str(index) for index in range(6)} or source in strings:
            raise ValueError("Expected one note_midi annotation for each data_source 0..5")
        strings.add(source)
        string = int(source)
        if not isinstance(annotation.get("data"), list):
            raise ValueError("note_midi data must be an observation list")
        for index, event in enumerate(annotation["data"]):
            start = finite(event["time"], "Reference onset")
            length = finite(event["duration"], "Reference note duration")
            start, end = interval(start, start + length, duration, "Reference note")
            midi = finite(event["value"], "Reference MIDI")
            if not 0 <= midi <= 127:
                raise ValueError("Reference MIDI is outside 0..127")
            notes.append({"start": start, "end": end, "midi": midi, "string": string,
                          "observationIndex": index})
    if strings != {str(index) for index in range(6)}:
        raise ValueError("Expected all six string note_midi annotations")
    notes.sort(key=lambda item: (item["start"], item["midi"], item["string"], item["observationIndex"]))
    return notes, duration


def prediction_notes(prediction):
    duration = finite(prediction["duration"], "Prediction duration")
    if (duration <= 0 or prediction.get("engine") != "chroma-v2"
            or prediction.get("noteEventsVersion") != 1
            or prediction.get("noteEventsLimit") != 24000
            or not isinstance(prediction.get("noteEventsTruncated"), bool)
            or not isinstance(prediction.get("noteEvents"), list)):
        raise ValueError("Expected the production version-1 note-event contract")
    coverage = finite(prediction["noteEventsCoverageEnd"], "Note coverage")
    if (not 0 <= coverage <= duration + 0.000001
            or (not prediction["noteEventsTruncated"] and abs(coverage - duration) > 0.000001)
            or len(prediction["noteEvents"]) > 24000):
        raise ValueError("Invalid note-event coverage or count")
    notes = []
    for index, event in enumerate(prediction["noteEvents"]):
        start, end = interval(event["start"], event["end"], duration, "Predicted note")
        midi = integer(event["midi"], "Predicted MIDI", 21, 108)
        evidence = {}
        for key in ("noteEvidence", "onsetEvidence"):
            evidence[key] = finite(event[key], key)
            if not 0 <= evidence[key] <= 1:
                raise ValueError(key + " is outside 0..1")
        # Keep duplicates and every register: extra notes must remain false positives.
        notes.append({"start": start, "end": end, "midi": midi,
                      "sourceIndex": index, **evidence})
    return notes, duration


def matching(reference, predicted, offsets=False, strings=False):
    """Deterministic maximum-cardinality bipartite matching, never greedy credit."""
    adjacency = []
    for estimated in predicted:
        candidates = []
        for index, actual in enumerate(reference):
            if (abs(estimated["start"] - actual["start"]) > ONSET_TOLERANCE + EPSILON
                    or abs(estimated["midi"] - actual["midi"]) > PITCH_TOLERANCE + EPSILON):
                continue
            if offsets and abs(estimated["end"] - actual["end"]) > max(
                    OFFSET_MINIMUM, OFFSET_RATIO * (actual["end"] - actual["start"])) + EPSILON:
                continue
            if strings and estimated.get("string") != actual.get("string"):
                continue
            candidates.append(index)
        candidates.sort(key=lambda index: (abs(estimated["start"] - reference[index]["start"]),
                                           abs(estimated["midi"] - reference[index]["midi"]), index))
        adjacency.append(candidates)
    owners = {}

    def augment(predicted_index, seen):
        for reference_index in adjacency[predicted_index]:
            if reference_index in seen:
                continue
            seen.add(reference_index)
            if reference_index not in owners or augment(owners[reference_index], seen):
                owners[reference_index] = predicted_index
                return True
        return False

    order = sorted(range(len(predicted)), key=lambda index: (
        predicted[index]["start"], predicted[index]["midi"], predicted[index]["end"], index))
    for index in order:
        augment(index, set())
    return sorted(owners.items())


def metric(reference, predicted, pairs):
    count = len(pairs)
    return {"referenceCount": len(reference), "predictionCount": len(predicted),
            "matchedCount": count, "falsePositives": len(predicted) - count,
            "falseNegatives": len(reference) - count,
            "precision": count / len(predicted) if predicted else 0.0,
            "recall": count / len(reference) if reference else 0.0,
            "f1": 2 * count / (len(reference) + len(predicted)) if reference or predicted else 0.0}


def error_summary(values):
    if not values:
        return {"meanSignedSeconds": None, "medianSignedSeconds": None,
                "meanAbsoluteSeconds": None, "medianAbsoluteSeconds": None,
                "p90AbsoluteSeconds": None}
    absolute = sorted(abs(value) for value in values)
    return {"meanSignedSeconds": statistics.mean(values),
            "medianSignedSeconds": statistics.median(values),
            "meanAbsoluteSeconds": statistics.mean(absolute),
            "medianAbsoluteSeconds": statistics.median(absolute),
            "p90AbsoluteSeconds": absolute[math.ceil(0.9 * len(absolute)) - 1]}


def score_notes(reference, predicted, strings=False):
    pairs = matching(reference, predicted)
    offset_pairs = matching(reference, predicted, offsets=True)
    onset_errors, offset_errors, duration_errors = [], [], []
    for reference_index, predicted_index in pairs:
        actual, estimated = reference[reference_index], predicted[predicted_index]
        onset_errors.append(estimated["start"] - actual["start"])
        offset_errors.append(estimated["end"] - actual["end"])
        duration_errors.append((estimated["end"] - estimated["start"])
                               - (actual["end"] - actual["start"]))
    result = {"onsetPitch": metric(reference, predicted, pairs),
              "onsetPitchOffset": metric(reference, predicted, offset_pairs),
              "timingOnOnsetPitchMatches": {"matchedCount": len(pairs),
                  "onset": error_summary(onset_errors), "offset": error_summary(offset_errors),
                  "duration": error_summary(duration_errors)},
              "onsetPitchMatches": [{"referenceIndex": a, "predictionIndex": b} for a, b in pairs]}
    if strings:
        result["stringPlacementDiagnostic"] = {
            "onsetPitchString": metric(reference, predicted, matching(reference, predicted, strings=True)),
            "scope": "Agreement with the recorded string; valid alternate fingerings can disagree. "
                     "This is not a requirement for pitch correctness or a claim of recovered fingering."}
    return result


def projection_notes(performance, duration):
    if performance.get("schemaVersion") != 1 or abs(
            finite(performance["duration"], "Performance duration") - duration) > 0.000001:
        raise ValueError("Performance output does not cover the native duration")
    if performance.get("tuningMidi") != TUNING:
        raise ValueError("Expected the production standard EADGBE tuning")
    ticks = integer(performance["ticksPerBeat"], "Ticks per beat", 1, 100000)
    projection = performance["projection"]
    status = projection.get("status")
    if status == "unavailable":
        return [], {"status": status, "reason": projection.get("reason"),
                    "counts": projection.get("counts"), "limit": projection.get("limit")}
    if status != "ready":
        raise ValueError("Unknown tab projection status")
    selection = projection["range"]
    if (finite(selection["start"], "Projection range start") != 0
            or abs(finite(selection["end"], "Projection range end") - duration) > 0.000001):
        raise ValueError("The benchmark requires the full source range, without trimming")
    tab = projection["tab"]
    tempo = finite(tab["tempo"], "Projected tempo")
    if tab.get("version") != 3 or not 40 <= tempo <= 200 or not isinstance(tab.get("notes"), list):
        raise ValueError("Expected a production version-3 projected tab")
    if finite(projection["tempo"], "Projection tempo") != tempo:
        raise ValueError("Tab and projection tempo disagree")
    seconds_per_tick = 60 / (tempo * ticks)
    notes = []
    for index, event in enumerate(tab["notes"]):
        string = integer(event["string"], "Tab string", 0, 5)
        fret = integer(event["fret"], "Tab fret", 0, 24)
        start = finite(event["tick"], "Tab tick") * seconds_per_tick
        end = start + finite(event["duration"], "Tab duration") * seconds_per_tick
        # v3 stores 1/960-tick units. At >=40 BPM, rounding is below 0.1 ms.
        start, end = interval(start, end, duration, "Projected note", tolerance=0.0001)
        notes.append({"start": start, "end": end, "midi": TUNING[string] + fret,
                      "string": string, "fret": fret, "sourceIndex": index})
    return notes, {"status": status, "range": selection, "tempo": tempo,
                   "counts": projection.get("counts"), "assumptions": projection.get("assumptions"),
                   "conversion": {"ticksPerBeat": ticks, "secondsPerTick": seconds_per_tick,
                                  "tuningMidi": TUNING}}


def evaluate(jams, prediction, performance=None):
    reference, reference_duration = reference_notes(jams)
    predicted, duration = prediction_notes(prediction)
    if abs(duration - reference_duration) > 0.02:
        raise ValueError("Prediction and reference duration differ by more than 20 ms")
    confirmed = [note for note in predicted if note["onsetEvidence"] >= 0.5]
    activity = [note for note in predicted if note["onsetEvidence"] == 0]
    result = {
        "schemaVersion": 1,
        "fixture": {"id": jams["file_metadata"].get("title"), "audioSeconds": duration,
                    "referenceSeconds": reference_duration, "referenceNoteCount": len(reference),
                    "notesPerStringLowToHigh": [sum(note["string"] == string for note in reference)
                                                for string in range(6)],
                    "scope": "Single previously used development recording; not held out. "
                             "No generalization claim for other songs, performers, or full mixes.",
                    "referenceScope": "Published hexaphonic-pickup-derived note annotations, "
                                      "used as supplied; no new manual performance annotation."},
        "protocol": {
            "onsetToleranceSeconds": ONSET_TOLERANCE, "pitchToleranceMidi": PITCH_TOLERANCE,
            "offsetTolerance": {"minimumSeconds": OFFSET_MINIMUM, "referenceDurationRatio": OFFSET_RATIO},
            "matching": "One-to-one maximum cardinality, separately for each criterion; "
                        "raw fractional reference MIDI, inclusive bounds with 1e-9 arithmetic epsilon.",
            "denominators": "Every reference note and every prediction; no alignment, trimming, "
                            "pitch-range filter, deduplication, or reference-tempo input. "
                            "All-event scores are primary; evidence-subset scores are diagnostics.",
            "zeroDenominators": "Precision, recall, and F1 are 0 when their denominator is 0.",
            "timing": "Predicted minus reference seconds, on deterministic onset/pitch matches only; "
                      "p90 uses nearest rank. This matching maximizes count, not timing quality.",
            "stringAmbiguity": "String-level reference multiplicity is retained, including unisons. "
                               "A mono pitch event cannot identify its original string."
        },
        "nativeCoverage": {"truncated": prediction["noteEventsTruncated"],
                           "coverageEnd": prediction["noteEventsCoverageEnd"],
                           "scoringRange": [0, reference_duration]},
        "rawNotes": {
            "all": score_notes(reference, predicted),
            "confirmedAttacks": score_notes(reference, confirmed),
            "activityOnly": score_notes(reference, activity),
            "counts": {"all": len(predicted), "confirmedAttacks": len(confirmed),
                       "activityOnly": len(activity),
                       "nonzeroUnconfirmed": len(predicted) - len(confirmed) - len(activity)}
        },
        "referenceAmbiguity": {
            "notesPlayableOnMultipleStandardStrings": sum(
                sum(0 <= math.floor(note["midi"] + 0.5) - opened <= 24 for opened in TUNING) > 1
                for note in reference),
            "crossStringSamePitchOnsetPairsWithinTolerance": sum(
                first["string"] != second["string"]
                and abs(first["start"] - second["start"]) <= ONSET_TOLERANCE + EPSILON
                and math.floor(first["midi"] + 0.5) == math.floor(second["midi"] + 0.5)
                for index, first in enumerate(reference) for second in reference[index + 1:])
        }
    }
    if performance is not None:
        projected, summary = projection_notes(performance, duration)
        result["projectedTab"] = {**summary, "sourcePredictionCount": len(predicted),
                                  "projectedNoteCount": len(projected),
                                  "scores": score_notes(reference, projected, strings=True)}
        result["playingStyleDiagnostic"] = {
            "accuracy": None, "reason": "These JAMS annotations contain no strumming/picking or "
                "stroke-direction ground truth. Dataset genre and comp/solo mode are not technique labels.",
            "productionOutput": performance.get("rhythm"),
            "hostTimings": performance.get("timings")}
    return result


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    command = subcommands.add_parser("evaluate", help="Score the complete pinned development take")
    command.add_argument("--reference", type=Path, required=True)
    command.add_argument("--prediction", type=Path, required=True)
    command.add_argument("--performance", type=Path)
    command.add_argument("--native-binary", type=Path)
    command.add_argument("--source-audio", type=Path)
    command.add_argument("--pcm", type=Path)
    command.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest_bytes = MANIFEST.read_bytes()
    fixture = next(item for item in json.loads(manifest_bytes)["fixtures"] if item["id"] == FIXTURE_ID)
    reference_bytes = args.reference.read_bytes()
    if (len(reference_bytes) != fixture["annotation"]["bytes"]
            or sha256(reference_bytes) != fixture["annotation"]["sha256"]):
        raise ValueError("Reference is not the pinned development JAMS fixture")
    prediction_bytes = args.prediction.read_bytes()
    performance_bytes = args.performance.read_bytes() if args.performance else None
    performance = json.loads(performance_bytes) if performance_bytes is not None else None
    if performance is not None and performance.get("nativePredictionSha256") != sha256(prediction_bytes):
        raise ValueError("Performance output belongs to a different native prediction")
    result = evaluate(json.loads(reference_bytes), json.loads(prediction_bytes), performance)
    audio_provenance, pcm_provenance = None, None
    if args.source_audio:
        audio_bytes = args.source_audio.read_bytes()
        if (len(audio_bytes) != fixture["audio"]["bytes"]
                or sha256(audio_bytes) != fixture["audio"]["sha256"]):
            raise ValueError("Source audio is not the pinned development WAV fixture")
        audio_provenance = {"bytes": len(audio_bytes), "sha256": sha256(audio_bytes)}
    if args.pcm:
        pcm_bytes = args.pcm.read_bytes()
        if not pcm_bytes or len(pcm_bytes) % 2:
            raise ValueError("PCM must contain complete signed-16-bit samples")
        pcm_duration = len(pcm_bytes) / 32000
        if abs(pcm_duration - result["fixture"]["audioSeconds"]) > 0.000001:
            raise ValueError("PCM duration does not match the native output")
        pcm_provenance = {"bytes": len(pcm_bytes), "sha256": sha256(pcm_bytes),
                          "sampleRate": 16000, "channels": 1, "encoding": "signed-16-bit little-endian",
                          "durationSeconds": pcm_duration}
    result["provenance"] = {
        "source": fixture["source"], "license": fixture["license"], "authors": fixture["authors"],
        "citation": fixture["citation"], "sourceManifest": str(MANIFEST.relative_to(REPO)),
        "sourceManifestSha256": sha256(manifest_bytes), "pinnedAudio": fixture["audio"],
        "referenceSha256": sha256(reference_bytes), "nativePredictionSha256": sha256(prediction_bytes),
        "performanceSha256": sha256(performance_bytes) if performance_bytes is not None else None,
        "nativeBinarySha256": sha256(args.native_binary.read_bytes()) if args.native_binary else None,
        "sourceAudio": audio_provenance, "nativeInputPcm": pcm_provenance,
        "evaluatorSha256": sha256(Path(__file__).read_bytes()),
        "performanceSources": performance.get("sources") if performance else None,
        "performanceRuntime": performance.get("runtime") if performance else None,
        "pythonVersion": platform.python_version(),
        "github": {key: os.environ.get(key) for key in
                   ("GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_EVENT_NAME", "GITHUB_HEAD_REF")}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    # Keep the full evidence readable in the completed CI job even after its
    # downloadable artifact expires. Markers allow exact extraction from logs.
    print("NOTE_QUALITY_REPORT_BEGIN")
    print(json.dumps(result, indent=2, allow_nan=False))
    print("NOTE_QUALITY_REPORT_END")


if __name__ == "__main__":
    main()
