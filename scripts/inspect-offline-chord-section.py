#!/usr/bin/env python3
"""Inspect an interval of a full-recording prediction without rerunning audio analysis."""
import argparse
import importlib.util
import json
from pathlib import Path


EVALUATOR_PATH = Path(__file__).with_name("evaluate-offline-chords-extended.py")
SPEC = importlib.util.spec_from_file_location("chord_evaluator", EVALUATOR_PATH)
E = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(E)


def timestamp(value):
    try:
        parts = value.split(":")
        if len(parts) == 1:
            return E.finite(float(value))
        if len(parts) == 2 and parts[0].isdigit() and 0 <= float(parts[1]) < 60:
            return E.finite(int(parts[0]) * 60 + float(parts[1]))
    except (ValueError, OverflowError):
        pass
    raise argparse.ArgumentTypeError("Use finite seconds or MM:SS.sss")


def clip(intervals, start, end):
    return [(max(a, start), min(b, end), chord) for a, b, chord in intervals
            if a < end and b > start]


def gaps(intervals, start, end):
    missing, cursor = [], start
    for a, b, _ in clip(intervals, start, end):
        if a > cursor:
            missing.append({"start": cursor, "end": a})
        cursor = max(cursor, b)
    if cursor < end:
        missing.append({"start": cursor, "end": end})
    return missing


def bounded(intervals, duration):
    if any(a < 0 or b > duration + 0.001 for a, b, _ in intervals):
        raise ValueError("An interval extends outside the recording duration")


def inspect(result, start, end, jams=None):
    duration, start, end = map(E.finite, (result["duration"], start, end))
    if duration <= 0 or not 0 <= start < end <= duration:
        raise ValueError("Select a nonempty interval within the recording duration")
    # Validate every interval before clipping, including passages outside selection.
    predicted = E.intervals(result["segments"])
    bounded(predicted, duration)
    selected = clip(predicted, start, end)
    segments = [{"start": max(item["start"], start), "end": min(item["end"], end),
                 "chord": item["chord"], "sourceStart": item["start"], "sourceEnd": item["end"],
                 "startClipped": item["start"] < start, "endClipped": item["end"] > end}
                for item in result["segments"] if item["start"] < end and item["end"] > start]
    missing = gaps(predicted, start, end)
    report = {"engine": result.get("engine"), "recordingSeconds": duration,
              "start": start, "end": end, "intervalSeconds": end - start,
              "context": "Supplied full-recording prediction; absolute times retained; analyzer not rerun.",
              "segments": segments, "predictionGaps": missing,
              "predictionGapSeconds": sum(g["end"] - g["start"] for g in missing),
              "predictedNSeconds": sum(b - a for a, b, c in selected if c[0] == "N"),
              "predictedXSeconds": sum(b - a for a, b, c in selected if c[0] == "X")}
    if jams is None:
        report["evaluation"] = "No timed reference supplied; raw predictions only, no accuracy claim."
        return report
    # Reuse the pinned evaluator's full-file duration, syntax and two-role checks.
    E.evaluate(result, jams)
    reference_duration = E.finite(jams["file_metadata"]["duration"])
    if reference_duration <= 0:
        raise ValueError("Reference duration must be positive")
    annotations = [a for a in jams["annotations"] if a["namespace"] == "chord"]
    report["references"] = {}
    for role, annotation in zip(("instructed", "performed"), annotations):
        reference = E.intervals(annotation["data"], reference=True)
        bounded(reference, reference_duration)
        missing = gaps(reference, start, end)
        report["references"][role] = {
            **E.score(clip(reference, start, end), selected),
            "referenceGaps": missing,
            "unannotatedReferenceSeconds": sum(g["end"] - g["start"] for g in missing),
            "annotationMetadata": annotation.get("annotation_metadata", {})}
    report["metricDefinitions"] = E.METRIC_DEFINITIONS
    report["evaluationPolicy"] = {
        **E.EVALUATION_POLICY,
        "denominator": "Entire selected annotated interval, excluding reference X only; no boundary trimming. Unannotated reference gaps are separately reported and cannot be scored. Projection has its own denominator.",
        "roles": "GuitarSet order: first chord annotation instructed, second performed.",
        "scope": "This selected interval is not a whole-song or held-out accuracy estimate."}
    return report


def human(report):
    lines = [f"Section {report['start']:.3f}–{report['end']:.3f} s ({report['intervalSeconds']:.3f} s)",
             report["context"], "* = boundary clipped for display; source chord boundary is unchanged"]
    for segment in report["segments"]:
        mark = " *" if segment["startClipped"] or segment["endClipped"] else ""
        label = "N (undetermined/no chord)" if segment["chord"] == "N" else segment["chord"]
        lines.append(f"{segment['start']:.3f}–{segment['end']:.3f}  {label}{mark}")
    for gap in report["predictionGaps"]:
        lines.append(f"{gap['start']:.3f}–{gap['end']:.3f}  MISSING PREDICTION")
    lines.append(f"Prediction gaps: {report['predictionGapSeconds']:.6f} s; "
                 f"N: {report['predictedNSeconds']:.6f} s; X: {report['predictedXSeconds']:.6f} s")
    if "references" not in report:
        lines.append(report["evaluation"])
    for role, reference in report.get("references", {}).items():
        lines.append(f"{role}: excluded reference X {reference['excludedUnknownReferenceSeconds']:.6f} s; "
                     f"unannotated {reference['unannotatedReferenceSeconds']:.6f} s; "
                     f"missing prediction on known reference {reference['missingPredictionSeconds']:.6f} s")
        for name, metric in reference["metrics"].items():
            value = "n/a" if metric["value"] is None else f"{metric['value']:.2%}"
            lines.append(f"  {name}: {value} ({metric['weightedCorrectSeconds']:.6f} / {metric['evaluatedSeconds']:.6f} s)")
    if "evaluationPolicy" in report:
        lines.extend([report["evaluationPolicy"]["denominator"], report["evaluationPolicy"]["scope"]])
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prediction", type=Path)
    parser.add_argument("--start", type=timestamp, required=True)
    parser.add_argument("--end", type=timestamp, required=True)
    parser.add_argument("--reference", type=Path, help="GuitarSet JAMS, instructed then performed")
    parser.add_argument("--json", nargs="?", const="-", metavar="PATH", help="JSON stdout, or write JSON to PATH and print text")
    args = parser.parse_args()
    try:
        report = inspect(E.read_json(args.prediction), args.start, args.end,
                         E.read_json(args.reference) if args.reference else None)
        report["predictionSha256"] = E.sha256(args.prediction)
        report["evaluatorSha256"] = E.sha256(EVALUATOR_PATH)
        if args.reference:
            report["referenceSha256"] = E.sha256(args.reference)
        encoded = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        if args.json and args.json != "-":
            destination = Path(args.json)
            if destination.resolve() in {args.prediction.resolve(), args.reference.resolve() if args.reference else None, EVALUATOR_PATH.resolve(), Path(__file__).resolve()}:
                raise ValueError("Output must not overwrite an input or script")
            destination.write_text(encoded, encoding="utf-8")
        print(encoded, end="") if args.json == "-" else print(human(report))
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
