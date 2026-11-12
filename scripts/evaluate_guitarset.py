#!/usr/bin/env python3
"""Reproduce actual model evaluation on an explicitly supplied GuitarSet subset.

Input pairs: <name>_mic.wav and <name>.reference.json with original Harte chord
intervals from GuitarSet's performed annotations. No audio or source lyrics are
checked into the application repository. Run with backend/.venv/bin/python.
"""
import argparse
import bisect
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import time

import psutil
import mir_eval.chord

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from freetune_analysis.pipeline import CHORD_QUALITIES  # noqa: E402


def harte(label):
    if label in {"N", "X", "?"}:
        return "X" if label == "?" else label
    if ":" in label:
        return label
    match = re.fullmatch(r"([A-G][#b]?)([^/]*)(?:/([A-G][#b]?))?", label)
    if not match:
        raise ValueError(f"Unsupported predicted label {label}")
    root, quality, bass = match.groups()
    qualities = {value: key for key, value in CHORD_QUALITIES.items()}
    result = root + ":" + qualities[quality]
    if bass:
        difference = (mir_eval.chord.pitch_class_to_semitone(bass) - mir_eval.chord.pitch_class_to_semitone(root)) % 12
        result += "/" + ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"][difference]
    return result


def canonical(label):
    root, bitmap, bass = mir_eval.chord.encode(harte(label), reduce_extended_chords=True)
    return int(root), tuple(int(value) for value in bitmap), int(bass)


def triad(label):
    root, bitmap, _ = mir_eval.chord.encode(harte(label), reduce_extended_chords=False)
    return int(root), tuple(int(value) for value in bitmap[:8])


def symbol_at(items, starts, point):
    index = bisect.bisect_right(starts, point) - 1
    return items[index]["label"] if index >= 0 and point < items[index]["end"] else "N"


def score(reference, prediction, duration, transform):
    end = min(duration, max((i["end"] for i in reference), default=0))
    points = sorted({0.0, end, *(max(0.0, min(end, float(i[k])))
                    for i in reference + prediction for k in ("start", "end"))})
    ref_start = [i["start"] for i in reference]
    pred_start = [i["start"] for i in prediction]
    agree = 0.0
    for a, b in zip(points, points[1:]):
        point = (a + b) / 2
        if transform(symbol_at(reference, ref_start, point)) == transform(symbol_at(prediction, pred_start, point)):
            agree += b - a
    return {"matchedSeconds": agree, "scoredSeconds": end,
            "agreement": agree / end if end else None}


def boundaries(reference, prediction, duration, tolerance=0.5):
    def changes(items):
        return [item["start"] for previous, item in zip(items, items[1:])
                if item["label"] != previous["label"] and 0 < item["start"] < duration]
    truth, predicted = changes(reference), changes(prediction)
    pairs = sorted((abs(a - b), i, j) for i, a in enumerate(truth)
                   for j, b in enumerate(predicted) if abs(a - b) <= tolerance)
    used_truth, used_pred, errors = set(), set(), []
    for error, i, j in pairs:
        if i not in used_truth and j not in used_pred:
            used_truth.add(i); used_pred.add(j); errors.append(error)
    precision = len(errors) / len(predicted) if predicted else 0
    recall = len(errors) / len(truth) if truth else 0
    return {"toleranceSeconds": tolerance, "matches": len(errors),
            "referenceChanges": len(truth), "predictedChanges": len(predicted),
            "precision": precision, "recall": recall,
            "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0,
            "matchedMeanAbsoluteErrorSeconds": sum(errors) / len(errors) if errors else None}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--model", choices=("small", "turbo"), default="small")
    parser.add_argument("--score-only", action="store_true", help="Rescore saved outputs without rerunning inference")
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    previous = {item["name"]: item for item in json.loads(args.output.read_text())["items"]} if args.score_only else {}
    results = []
    report = {"dataset": "GuitarSet v1.1.0 (10 instrumental excerpts; not full sung songs)",
              "source": "https://zenodo.org/records/3371780", "license": "CC-BY-4.0",
              "annotations": "Performed chord annotations; corpus metadata describes semi-automatic transcription with manual verification. No new human verification was performed.",
              "selection": "Two players 00,04 × first lexicographic comp excerpt in BN,Funk,Jazz,Rock,SS; known timing-error files excluded.",
              "environment": {"platform": platform.platform(), "threads": 2,
                              "physicalAndroid": False, "model": args.model},
              "measurement": "Subprocess wall time includes model imports; RSS sampled every 0.2s including descendant FFmpeg. Shared Linux host, concurrently developing/building app. Not a phone benchmark.",
              "metricDefinitions": {"exact": "Equal root pitch class, full pitch-class bitmap (extended chords reduced) and bass; enharmonic spellings/root inversion labels normalized using mir_eval0.8.2. Not raw string equality.",
                                    "triad": "Equal root pitch class and interval bitmap through augmented fifth, ignoring bass and upper extensions (mir_eval triads convention).", "boundaries": "One-to-one nearest chord change matching within0.5seconds; errors describe matched changes only."},
              "items": results}
    for reference_path in sorted(args.fixtures.glob("*.reference.json")):
        reference = json.loads(reference_path.read_text())
        name = reference["name"]
        source = args.fixtures / f"{name}_mic.wav"
        directory = args.work / name
        directory.mkdir(parents=True, exist_ok=True)
        env = {**os.environ, "FREETUNE_WHISPER_MODEL": args.model, "FREETUNE_CPU_THREADS": "2",
               "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2", "HF_HUB_OFFLINE": "1",
               "FREETUNE_WHISPER_PATH": str(ROOT / "backend" / "data" / "models" / f"whisper-{args.model}")}
        start, peak = time.monotonic(), 0
        with (directory / "worker.log").open("a") as log:
            if args.score_only:
                process = None
            else:
                process = subprocess.Popen([sys.executable, "-m", "freetune_analysis.worker",
                                            "--input", str(source), "--directory", str(directory), "--language", "en"],
                                           cwd=ROOT / "backend", env=env, stdout=log, stderr=log)
            while process is not None and process.poll() is None:
                try:
                    parent = psutil.Process(process.pid)
                    peak = max(peak, sum(p.memory_info().rss for p in [parent] + parent.children(recursive=True)))
                except psutil.NoSuchProcess:
                    pass
                if time.monotonic() - start > 300:
                    process.kill()
                    break
                time.sleep(0.2)
            if process is not None:
                process.wait()
        seconds = time.monotonic() - start
        state_path = directory / "state.json"
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        result = state.get("result", {})
        prediction = result.get("chords", [])
        duration = min(reference["duration"], result.get("duration", reference["duration"]))
        item = {"name": name, "sha256": reference["sha256"], "status": state.get("status", "worker_failed"),
                "durationSeconds": result.get("duration"), "wallSeconds": round(seconds, 3),
                "peakRssMiB": round(peak / 1024**2, 2), "chordIntervals": len(prediction),
                "exact": score(reference["chords"], prediction, duration, canonical),
                "triad": score(reference["chords"], prediction, duration, triad),
                "boundaries": boundaries(reference["chords"], prediction, duration),
                "unwantedLyricLines": len(result.get("lyrics", [])),
                "unwantedLexicalWords": sum(len(re.findall(r"\w+", line["text"])) for line in result.get("lyrics", [])),
                "warnings": result.get("warnings", [])}
        if args.score_only:
            item.update({key: previous[name][key] for key in ("wallSeconds", "peakRssMiB")})
        results.append(item)
        for metric in ("exact", "triad"):
            total = sum(i[metric]["scoredSeconds"] for i in results)
            report[metric + "WeightedAgreement"] = sum(i[metric]["matchedSeconds"] for i in results) / total if total else None
        args.output.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(item), flush=True)


if __name__ == "__main__":
    main()
