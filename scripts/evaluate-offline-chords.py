#!/usr/bin/env python3
"""Score production chord_probe JSON against GuitarSet's instructed chords.

Only the standard library is required. Accuracy is exact overlap duration,
including transitions, silence labels, and missing prediction intervals. The
optional interior score is reported separately and never replaces that score.
"""

import argparse
import json
import math
import re
from pathlib import Path


PITCHES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def chord_identity(label):
    if label == "N":
        return "N"
    # The production alphabet is major/minor triads; the reference uses JAMS.
    match = re.fullmatch(r"([A-G])([#b]?)(m|:maj|:min)?", label)
    if not match:
        raise ValueError("Unsupported reference or predicted chord: " + repr(label))
    note, accidental, quality = match.groups()
    pitch = (PITCHES[note] + {"": 0, "#": 1, "b": -1}[accidental]) % 12
    return pitch, "minor" if quality in ("m", ":min") else "major"


def finite(value, field):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(field + " must be a finite number")
    return float(value)


def predictions(result):
    duration = finite(result["duration"], "duration")
    if duration <= 0:
        raise ValueError("Analysis duration must be positive")
    segments = []
    previous_end = 0.0
    for item in result["segments"]:
        start = finite(item["start"], "segment.start")
        end = finite(item["end"], "segment.end")
        if start < previous_end or end <= start or end > duration + 0.001:
            raise ValueError("Predicted intervals must be ordered, disjoint, and within the audio")
        segments.append((start, min(end, duration), chord_identity(item["chord"])))
        previous_end = end
    return duration, segments


def overlap_score(reference, predicted, margin=0.0):
    correct = 0.0
    total = 0.0
    for start, end, chord in reference:
        start += margin
        end -= margin
        if end <= start:
            continue
        total += end - start
        for pred_start, pred_end, pred_chord in predicted:
            if pred_start >= end:
                break
            if pred_chord == chord:
                correct += max(0.0, min(end, pred_end) - max(start, pred_start))
    if not total:
        raise ValueError("No reference duration remains for evaluation")
    return {
        "evaluatedSeconds": round(total, 6),
        "correctSeconds": round(correct, 6),
        "accuracy": round(correct / total, 6),
    }


def evaluate(result, jams=None, boundary_margin=0.25):
    duration, predicted = predictions(result)
    elapsed = finite(result["elapsedMs"], "elapsedMs")
    if elapsed < 0:
        raise ValueError("elapsedMs must be non-negative")
    named_seconds = sum(end - start for start, end, chord in predicted if chord != "N")
    report = {
        "engine": result.get("engine"),
        "audioSeconds": duration,
        "segmentCount": len(predicted),
        "namedChordSeconds": round(named_seconds, 6),
        "unidentifiedOrMissingSeconds": round(max(0.0, duration - named_seconds), 6),
        "key": result.get("key"),
        "tempo": result.get("tempo"),
        "elapsedMs": elapsed,
        "processingSecondsPerAudioSecond": round(elapsed / 1000.0 / duration, 6),
        "timingScope": "Production CLI on this host with already decoded PCM; excludes decoding, mobile bridge, UI, and phone performance.",
    }
    if jams is None:
        report["accuracyMeasured"] = False
        return report
    annotations = jams["annotations"]
    # GuitarSet orders the instructed lead-sheet annotation before performed
    # chords. Verify the selection, rather than scoring its inferred extensions.
    chord_annotations = [item for item in annotations if item["namespace"] == "chord"]
    if not chord_annotations:
        raise ValueError("No chord annotation in JAMS")
    instructed = chord_annotations[0]
    if "performed" in json.dumps(instructed.get("annotation_metadata", {})).lower():
        raise ValueError("First chord annotation is not the instructed lead sheet")
    reference = []
    previous_end = 0.0
    for item in instructed["data"]:
        start = finite(item["time"], "reference.time")
        end = start + finite(item["duration"], "reference.duration")
        if start < previous_end - 1e-8 or end <= start:
            raise ValueError("Reference intervals must be ordered and disjoint")
        reference.append((start, end, chord_identity(item["value"])))
        previous_end = end
    reference_duration = finite(jams["file_metadata"]["duration"], "reference.duration")
    if abs(duration - reference_duration) > 0.02:
        raise ValueError("Prediction and reference durations differ by more than 20 ms")
    expected_tempo = next(
        (item["data"][0]["value"] for item in annotations if item["namespace"] == "tempo" and item["data"]),
        None,
    )
    expected_key = next(
        (item["data"][0]["value"] for item in annotations if item["namespace"] == "key_mode" and item["data"]),
        None,
    )
    report.update({
        "accuracyMeasured": True,
        "referenceTrack": jams["file_metadata"].get("title"),
        "referenceType": "GuitarSet instructed lead-sheet chords; root and major/minor quality, enharmonic-equivalent; inversions/extensions not scored.",
        "fullDuration": overlap_score(reference, predicted),
        "referenceTempo": expected_tempo,
        "referenceKey": expected_key,
        "limitations": "One real acoustic-guitar performance; this score does not establish accuracy on arbitrary songs or full mixes.",
    })
    if boundary_margin > 0:
        report["interiorOnly"] = {
            "excludedSecondsAtEachIntervalEdge": boundary_margin,
            **overlap_score(reference, predicted, boundary_margin),
        }
    if expected_tempo is not None and result.get("tempo") is not None:
        report["tempoAbsoluteErrorBpm"] = abs(float(result["tempo"]) - float(expected_tempo))
    if expected_key is not None and result.get("key") is not None:
        ref_key = expected_key.replace(":major", ":maj").replace(":minor", ":min")
        report["keyMatches"] = chord_identity(result["key"]) == chord_identity(ref_key)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prediction", type=Path, help="JSON written by the production chord_probe CLI")
    parser.add_argument("--jams", type=Path, help="Optional GuitarSet JAMS reference; omitted for full-song smoke statistics")
    parser.add_argument("--boundary-margin", type=float, default=0.25, help="Additional interior score; 0 disables it (default: 0.25 seconds)")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not math.isfinite(args.boundary_margin) or args.boundary_margin < 0:
        parser.error("--boundary-margin must be finite and non-negative")
    result = json.loads(args.prediction.read_text())
    jams = json.loads(args.jams.read_text()) if args.jams else None
    report = evaluate(result, jams, args.boundary_margin)
    text = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
