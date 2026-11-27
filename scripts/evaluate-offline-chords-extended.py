#!/usr/bin/env python3
"""Evaluate audio-only chord predictions without conflating extended qualities.

Exact root/formula agreement ignores slash bass but retains added/omitted notes.
Major/minor projection and pitch-class Jaccard are separate secondary metrics.
GuitarSet instructed and performed annotations are evaluated independently.
Usage: evaluate-offline-chords-extended.py one prediction.json reference.jams
       evaluate-offline-chords-extended.py compare --help
       evaluate-offline-chords-extended.py self-test
"""

import argparse
import hashlib
import json
import math
import re
from pathlib import Path


NOTES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
FORMULAS = {
    "maj": (0, 4, 7), "min": (0, 3, 7), "5": (0, 7), "1": (0,),
    "sus2": (0, 2, 7), "sus4": (0, 5, 7), "dim": (0, 3, 6), "aug": (0, 4, 8),
    "maj6": (0, 4, 7, 9), "min6": (0, 3, 7, 9),
    "7": (0, 4, 7, 10), "maj7": (0, 4, 7, 11), "min7": (0, 3, 7, 10),
    "minmaj7": (0, 3, 7, 11), "dim7": (0, 3, 6, 9), "hdim7": (0, 3, 6, 10),
    "9": (0, 4, 7, 10, 2), "maj9": (0, 4, 7, 11, 2), "min9": (0, 3, 7, 10, 2),
    "11": (0, 4, 7, 10, 2, 5), "maj11": (0, 4, 7, 11, 2, 5), "min11": (0, 3, 7, 10, 2, 5),
    "13": (0, 4, 7, 10, 2, 5, 9), "maj13": (0, 4, 7, 11, 2, 5, 9), "min13": (0, 3, 7, 10, 2, 5, 9),
    "add9": (0, 4, 7, 2), "minadd9": (0, 3, 7, 2),
}
ALIASES = {"": "maj", "m": "min", "6": "maj6", "m6": "min6", "m7": "min7",
           "m9": "min9", "m11": "min11", "m13": "min13", "madd9": "minadd9",
           "mMaj7": "minmaj7", "m7b5": "hdim7"}
METRIC_DEFINITIONS = {
    "exactRootAndFormula": "Duration-weighted identical enharmonic root and relative pitch-class formula. Slash bass is ignored; added/omitted notes and dominant/major sevenths remain distinct.",
    "rootOnly": "Duration-weighted identical enharmonic root, ignoring chord quality; N matches N only.",
    "majorMinorProjection": "Secondary triad score. Eligible references contain a complete unambiguous major (1,3,5) or minor (1,b3,5) triad. Other reference duration is explicitly excluded; non-projectable predictions count wrong.",
    "pitchClassJaccard": "Secondary harmonic similarity: mean intersection/union of absolute pitch-class sets. Can be high despite a wrong root or quality; not exact chord accuracy.",
}
EVALUATION_POLICY = {
    "unknownLabels": "X in the reference is excluded and its duration is reported. X in predictions counts wrong on known reference chords. Unsupported chord syntax raises an error instead of being dropped.",
    "noChord": "N is a known no-chord label: N matches N. N is excluded from the separately denominated major/minor projection because it contains no triad.",
    "predictionGaps": "Missing prediction time counts wrong on known reference intervals and is reported in missingPredictionSeconds. Overlapping or invalid intervals fail validation.",
}


def degree(value):
    match = re.fullmatch(r"([b#]*)([1-9][0-9]*)", value)
    if not match:
        raise ValueError("Unsupported Harte interval: " + repr(value))
    accidentals, number = match.groups()
    return ([0, 2, 4, 5, 7, 9, 11][(int(number) - 1) % 7]
            + accidentals.count("#") - accidentals.count("b")) % 12


def parse_chord(label):
    if label in ("N", "X"):
        return label, ()
    match = re.fullmatch(r"([A-G])([b#]*)([^/]*)?(?:/[^/]+)?", label)
    if not match:
        raise ValueError("Unsupported chord label: " + repr(label))
    note, accidental, suffix = match.groups()
    root = (NOTES[note] + accidental.count("#") - accidental.count("b")) % 12
    explicit_harte = (suffix or "").startswith(":")
    suffix = (suffix or "").removeprefix(":")
    match = re.fullmatch(r"([^()]*)(?:\(([^()]*)\))?", suffix)
    if not match:
        raise ValueError("Unsupported chord suffix: " + repr(suffix))
    quality, modifications = match.groups()
    # Harte C:(1,3,5) explicitly lists notes instead of supplying a shorthand.
    if explicit_harte and quality == "" and modifications is not None:
        formula = {0}
    else:
        shorthand = ALIASES.get(quality, quality)
        if shorthand not in FORMULAS:
            raise ValueError("Unsupported chord quality: " + repr(quality))
        formula = set(FORMULAS[shorthand])
    if modifications:
        for item in modifications.split(","):
            item = item.strip()
            if item.startswith("*"):
                formula.discard(degree(item[1:]))
            else:
                formula.add(degree(item))
    return root, tuple(sorted(formula))


def major_minor(chord):
    if chord is None or isinstance(chord[0], str):
        return None
    root, formula = chord
    if {0, 4, 7}.issubset(formula) and 3 not in formula:
        return root, "maj"
    if {0, 3, 7}.issubset(formula) and 4 not in formula:
        return root, "min"
    return None


def jaccard(reference, predicted):
    if predicted is None:
        return 0.0
    if reference[0] == "N" or predicted[0] == "N":
        return float(reference[0] == predicted[0])
    if isinstance(predicted[0], str):
        return 0.0
    expected = {(reference[0] + note) % 12 for note in reference[1]}
    actual = {(predicted[0] + note) % 12 for note in predicted[1]}
    return len(expected & actual) / len(expected | actual) if expected | actual else 1.0


def finite(value):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise ValueError("Timing values must be finite numbers")
    return float(value)


def intervals(items, reference=False):
    output, previous_end = [], 0.0
    for item in items:
        start = finite(item["time"] if reference else item["start"])
        end = start + finite(item["duration"]) if reference else finite(item["end"])
        if start < previous_end - 1e-8 or end <= start:
            raise ValueError("Intervals must be ordered, positive, and disjoint")
        output.append((start, end, parse_chord(item["value"] if reference else item["chord"])))
        previous_end = end
    return output


def metric(numerator, denominator):
    return {"value": numerator / denominator if denominator else None,
            "weightedCorrectSeconds": numerator, "evaluatedSeconds": denominator}


def score(reference, predicted):
    sums = {key: 0.0 for key in METRIC_DEFINITIONS}
    total, triad_seconds, unknown_seconds, missing_seconds = 0.0, 0.0, 0.0, 0.0
    for start, end, expected in reference:
        if expected[0] == "X":
            unknown_seconds += end - start
            continue
        total += end - start
        projection = major_minor(expected)
        if projection is not None:
            triad_seconds += end - start
        covered = 0.0
        for pred_start, pred_end, actual in predicted:
            if pred_start >= end:
                break
            overlap = max(0.0, min(end, pred_end) - max(start, pred_start))
            if not overlap:
                continue
            covered += overlap
            sums["exactRootAndFormula"] += overlap * (actual == expected)
            sums["rootOnly"] += overlap * (actual[0] == expected[0])
            sums["majorMinorProjection"] += overlap * (projection is not None and major_minor(actual) == projection)
            sums["pitchClassJaccard"] += overlap * jaccard(expected, actual)
        missing_seconds += max(0.0, end - start - covered)
    return {"metrics": {key: metric(value, triad_seconds if key == "majorMinorProjection" else total)
                        for key, value in sums.items()},
            "excludedUnknownReferenceSeconds": unknown_seconds,
            "excludedFromMajorMinorSeconds": total - triad_seconds,
            "missingPredictionSeconds": missing_seconds}


def evaluate(result, jams):
    predicted = intervals(result["segments"])
    duration = finite(result["duration"])
    reference_duration = finite(jams["file_metadata"]["duration"])
    if abs(duration - reference_duration) > 0.02:
        raise ValueError("Prediction and reference duration differ by more than 20 ms")
    if predicted and predicted[-1][1] > duration + 0.001:
        raise ValueError("Prediction extends beyond audio duration")
    annotations = [a for a in jams["annotations"] if a["namespace"] == "chord"]
    if len(annotations) != 2:
        raise ValueError("Expected GuitarSet instructed and performed chord annotations")
    references = {}
    for role, annotation in zip(("instructed", "performed"), annotations):
        reference = intervals(annotation["data"], reference=True)
        references[role] = score(reference, predicted)
        references[role]["annotationMetadata"] = annotation.get("annotation_metadata", {})
    return {"track": jams["file_metadata"].get("title"), "engine": result.get("engine"),
            "audioSeconds": duration, "elapsedMs": result.get("elapsedMs"),
            "segmentCount": len(predicted), "references": references}


def aggregate(reports):
    aggregated = {}
    for role in ("instructed", "performed"):
        role_reports = [report["references"][role] for report in reports]
        metrics = {}
        for key in METRIC_DEFINITIONS:
            values = [item["metrics"][key] for item in role_reports]
            metrics[key] = metric(sum(v["weightedCorrectSeconds"] for v in values),
                                  sum(v["evaluatedSeconds"] for v in values))
            macro = [v["value"] for v in values if v["value"] is not None]
            metrics[key]["meanAcrossClips"] = sum(macro) / len(macro) if macro else None
        aggregated[role] = {"metrics": metrics,
                            "excludedUnknownReferenceSeconds": sum(r["excludedUnknownReferenceSeconds"] for r in role_reports),
                            "excludedFromMajorMinorSeconds": sum(r["excludedFromMajorMinorSeconds"] for r in role_reports),
                            "missingPredictionSeconds": sum(r["missingPredictionSeconds"] for r in role_reports)}
    return {"clipCount": len(reports), "audioSeconds": sum(r["audioSeconds"] for r in reports),
            "references": aggregated}


def read_json(path):
    return json.loads(path.read_text())


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def collapse(sequence):
    output = []
    for item in sequence:
        if not output or item != output[-1]:
            output.append(item)
    return output


def event_edits(expected, predicted):
    """Levenshtein event counts; durations are deliberately absent."""
    table = [list(range(len(predicted) + 1))]
    for i, reference in enumerate(expected, 1):
        row = [i]
        for j, actual in enumerate(predicted, 1):
            row.append(min(table[i - 1][j] + 1, row[j - 1] + 1,
                           table[i - 1][j - 1] + (reference != actual)))
        table.append(row)
    i, j = len(expected), len(predicted)
    counts = {"matchedEvents": 0, "substitutionEvents": 0,
              "missingExpectedEvents": 0, "extraPredictedEvents": 0}
    while i or j:
        if i and j and table[i][j] == table[i - 1][j - 1] + (expected[i - 1] != predicted[j - 1]):
            counts["matchedEvents" if expected[i - 1] == predicted[j - 1] else "substitutionEvents"] += 1
            i, j = i - 1, j - 1
        elif i and table[i][j] == table[i - 1][j] + 1:
            counts["missingExpectedEvents"] += 1
            i -= 1
        else:
            counts["extraPredictedEvents"] += 1
            j -= 1
    return {"editDistance": table[-1][-1], "expectedEventCount": len(expected),
            "predictedEventCount": len(predicted), **counts}


def evaluate_sequence(result, reference):
    predicted = collapse([chord for _, _, chord in intervals(result["segments"])])
    # Silence outside the musical sequence is not a printed harmonic event.
    while predicted and predicted[0][0] == "N":
        predicted.pop(0)
    while predicted and predicted[-1][0] == "N":
        predicted.pop()
    variants = []
    for variant in reference["sequenceVariants"]:
        expected = []
        for section in reference["sections"]:
            repetitions = variant["repeatOverrides"].get(section["name"], section["printedRepetitions"])
            expected.extend([parse_chord(chord) for chord in section["canonicalChords"]] * repetitions)
        expected = collapse(expected)
        variants.append({"name": variant["name"], "status": variant["status"],
                         "exactRootAndFormula": event_edits(expected, predicted),
                         "rootOnly": event_edits(collapse([chord[0] for chord in expected]),
                                                 collapse([chord[0] for chord in predicted]))})
    return {"timingStatus": reference["timingStatus"],
            "comparisonPolicy": reference["comparisonPolicy"],
            "metricWarning": "These are unit-cost ordered event edit counts, not duration-weighted accuracy. Counts describe one optimal alignment; no best structural variant is selected. Root-only sequences additionally merge consecutive equal roots.",
            "engine": result.get("engine"), "variants": variants}


def self_test():
    """Check independent musical/interval cases, including misleading scores."""
    import unittest

    class EvaluationSemantics(unittest.TestCase):
        def test_dominant_ninth_is_not_add9(self):
            self.assertEqual(parse_chord("C9"), (0, (0, 2, 4, 7, 10)))
            self.assertEqual(parse_chord("Cadd9"), (0, (0, 2, 4, 7)))
            self.assertNotEqual(parse_chord("C9"), parse_chord("Cadd9"))
            self.assertEqual(parse_chord("C:maj(9)"), parse_chord("Cadd9"))
            self.assertEqual(parse_chord("C(9)"), parse_chord("Cadd9"))

        def test_explicit_notes_omissions_and_inversions(self):
            self.assertEqual(parse_chord("C:maj9(*1,*5)"), (0, (2, 4, 11)))
            self.assertEqual(parse_chord("C:(1,3,5,b7,9)"), parse_chord("C9"))
            self.assertEqual(parse_chord("C#:min7/5"), parse_chord("Dbm7"))
            self.assertNotEqual(parse_chord("C:maj(*5)"), parse_chord("C"))

        def test_equal_pitch_sets_do_not_imply_same_root(self):
            reference, predicted = parse_chord("Csus2"), parse_chord("Gsus4")
            result = score([(0, 1, reference)], [(0, 1, predicted)])
            self.assertEqual(result["metrics"]["exactRootAndFormula"]["value"], 0)
            self.assertEqual(result["metrics"]["rootOnly"]["value"], 0)
            self.assertEqual(result["metrics"]["pitchClassJaccard"]["value"], 1)
            self.assertIsNone(result["metrics"]["majorMinorProjection"]["value"])

        def test_boundary_weights_and_missing_intervals(self):
            c, g = parse_chord("C"), parse_chord("G")
            reference = [(0, 2, c), (2, 4, g)]
            result = score(reference, [(0, 1, c), (1, 4, g)])
            self.assertEqual(result["metrics"]["exactRootAndFormula"]["value"], 0.75)
            result = score(reference, [(0, 1, c), (2, 3, g)])
            self.assertEqual(result["metrics"]["exactRootAndFormula"]["value"], 0.5)
            self.assertEqual(result["missingPredictionSeconds"], 2)

        def test_unknown_and_no_chord_are_distinct(self):
            c, g, n, x = map(parse_chord, ("C", "G", "N", "X"))
            result = score([(0, 2, x), (2, 3, n), (3, 4, c)],
                           [(0, 2, g), (2, 3, n), (3, 4, x)])
            self.assertEqual(result["excludedUnknownReferenceSeconds"], 2)
            self.assertEqual(result["metrics"]["exactRootAndFormula"]["evaluatedSeconds"], 2)
            self.assertEqual(result["metrics"]["exactRootAndFormula"]["value"], 0.5)
            self.assertEqual(result["metrics"]["majorMinorProjection"]["evaluatedSeconds"], 1)
            self.assertEqual(result["metrics"]["majorMinorProjection"]["value"], 0)

        def test_invalid_overlaps_and_nonfinite_times_fail(self):
            with self.assertRaises(ValueError):
                intervals([{"start": 0, "end": 2, "chord": "C"},
                           {"start": 1, "end": 3, "chord": "G"}])
            with self.assertRaises(ValueError):
                intervals([{"start": 0, "end": float("nan"), "chord": "C"}])
            with self.assertRaises(ValueError):
                intervals([{"start": 2, "end": 1, "chord": "C"}])

        def test_untimed_event_insertions_deletions_substitutions(self):
            self.assertEqual(event_edits(["C", "G"], ["C"])["missingExpectedEvents"], 1)
            self.assertEqual(event_edits(["C"], ["C", "G"])["extraPredictedEvents"], 1)
            self.assertEqual(event_edits(["C"], ["G"])["substitutionEvents"], 1)
            self.assertEqual(event_edits(["C", "G"], ["C", "G"])["editDistance"], 0)

    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(EvaluationSemantics))
    if not result.wasSuccessful():
        raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("self-test", help="Check chord semantics, interval weights and invalid-input handling")
    one = commands.add_parser("one")
    one.add_argument("prediction", type=Path)
    one.add_argument("jams", type=Path)
    one.add_argument("--output", type=Path)
    sequence = commands.add_parser("sequence", help="Compare untimed chord event order; never reports duration accuracy")
    sequence.add_argument("prediction", type=Path)
    sequence.add_argument("reference", type=Path)
    sequence.add_argument("--output", type=Path)
    compare = commands.add_parser("compare")
    compare.add_argument("--selection", type=Path, required=True)
    compare.add_argument("--annotations", type=Path, required=True)
    compare.add_argument("--baseline", type=Path, required=True)
    compare.add_argument("--candidate", type=Path, required=True)
    compare.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.command == "self-test":
        self_test()
        return
    if args.command == "one":
        report = {"metricDefinitions": METRIC_DEFINITIONS, "evaluationPolicy": EVALUATION_POLICY,
                  **evaluate(read_json(args.prediction), read_json(args.jams))}
    elif args.command == "sequence":
        report = {"predictionSha256": sha256(args.prediction), "referenceSha256": sha256(args.reference),
                  **evaluate_sequence(read_json(args.prediction), read_json(args.reference))}
    else:
        selection = read_json(args.selection)
        results, provenance = {"baseline": [], "candidate": []}, []
        for track in selection["tracks"]:
            annotation = args.annotations / (track + ".jams")
            jams = read_json(annotation)
            entry = {"track": track, "annotationSha256": sha256(annotation)}
            for label, directory in (("baseline", args.baseline), ("candidate", args.candidate)):
                prediction = directory / (track + ".json")
                results[label].append(evaluate(read_json(prediction), jams))
                entry[label + "PredictionSha256"] = sha256(prediction)
            provenance.append(entry)
        report = {"metricDefinitions": METRIC_DEFINITIONS, "evaluationPolicy": EVALUATION_POLICY,
                  "referenceLimitations": "Instructed chords are the lead sheet; performed chords are sheet-informed semi-automatic note-derived annotations. Scores are reported independently and are not evidence of arbitrary full-mix accuracy.",
                  "selectionSha256": sha256(args.selection), "provenance": provenance,
                  "baseline": {"aggregate": aggregate(results["baseline"]), "tracks": results["baseline"]},
                  "candidate": {"aggregate": aggregate(results["candidate"]), "tracks": results["candidate"]}}
    text = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
