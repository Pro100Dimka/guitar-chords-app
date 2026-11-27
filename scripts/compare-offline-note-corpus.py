#!/usr/bin/env python3
"""Compare complete native note outputs on the twelve pinned development takes.

The host probe evaluates the model once per recording, then applies the current
and frozen baseline note decoders to the same frames. This runner never chooses
thresholds, fits timing, filters notes, or turns an accuracy score into a CI gate.
It fails on missing/invalid evidence and withholds partial-corpus aggregates.
"""

import argparse
import hashlib
import importlib.util
import io
import json
import os
import platform
import subprocess
import time
import wave
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
MANIFEST = REPO / "docs/offline-chord-quality-fixtures.json"
BASELINE_SOURCE = REPO / "android/song-fingerprint/src/bin/diagnostics/note_events_baseline.rs"
BASELINE_COMMIT = "8e9ba173fb03d53d649ab2aa577fa6a762caeeb0"
BASELINE_BLOB = "33a4e5221f63d57ee3f1b62cc4f2b48e94af461c"
CRITERIA = ("onsetPitch", "onsetPitchOffset")
COUNTS = ("referenceCount", "predictionCount", "matchedCount", "falsePositives", "falseNegatives")
SPEC = importlib.util.spec_from_file_location(
    "note_evaluator", REPO / "scripts/evaluate-offline-note-events.py")
EVALUATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EVALUATOR)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def reject_constant(value):
    raise ValueError("Non-finite JSON number: " + value)


def read_json(data):
    return json.loads(data, parse_constant=reject_constant)


def write_json(path, value):
    with path.open("x", encoding="utf-8") as output:
        json.dump(value, output, indent=2, allow_nan=False)
        output.write("\n")


def file_evidence(path):
    data = path.read_bytes()
    return data, {"bytes": len(data), "sha256": sha256(data)}


def pinned_file(path, expected):
    data, evidence = file_evidence(path)
    if evidence != {"bytes": expected["bytes"], "sha256": expected["sha256"]}:
        raise ValueError("Pinned file size or SHA-256 mismatch: " + path.name)
    return data, evidence


def micro(metrics):
    totals = {key: sum(item[key] for item in metrics) for key in COUNTS}
    reference, predicted, matched = (totals[key] for key in COUNTS[:3])
    return {**totals,
            "precision": matched / predicted if predicted else 0.0,
            "recall": matched / reference if reference else 0.0,
            "f1": 2 * matched / (reference + predicted) if reference + predicted else 0.0}


def differences(current, baseline):
    return {key: current[key] - baseline[key] for key in (*COUNTS, "precision", "recall", "f1")}


def comparison(records, error=None):
    complete = (error is None and len(records) == 12
                and all(record["status"] == "complete" for record in records))
    if not complete:
        return {"complete": False, "micro": None, "regressions": None,
                "reason": "All twelve declared recordings and evidence writes must succeed; no partial-corpus score is reported."}
    aggregate = {side: {criterion: micro([record[side][criterion] for record in records])
                        for criterion in CRITERIA} for side in ("baseline", "current")}
    aggregate["delta"] = {criterion: differences(aggregate["current"][criterion],
                                                 aggregate["baseline"][criterion])
                          for criterion in CRITERIA}
    regressions = []
    for record in records:
        for criterion in CRITERIA:
            delta = record["delta"][criterion]
            worse = [key for key in ("precision", "recall", "f1") if delta[key] < -1e-12]
            if worse:
                regressions.append({"track": record["track"], "criterion": criterion,
                                    "metrics": worse, "delta": delta})
    return {"complete": True, "micro": aggregate, "regressions": regressions}


def validate_track(fixture, prepared, directory):
    track = fixture["track"]
    audio, audio_hash = pinned_file(directory / "audio" / Path(fixture["audio"]["member"]).name,
                                    fixture["audio"])
    annotation, annotation_hash = pinned_file(
        directory / "annotations" / Path(fixture["annotation"]["member"]).name, fixture["annotation"])
    jams = read_json(annotation)
    if jams["file_metadata"].get("title") != track:
        raise ValueError("Reference title does not identify the declared recording")
    reference, reference_duration = EVALUATOR.reference_notes(jams)
    pcm_path = directory / "pcm" / (track + ".pcm")
    if Path(prepared["path"]).resolve() != pcm_path.resolve():
        raise ValueError("Prepared PCM path does not identify this recording")
    pcm, pcm_hash = pinned_file(pcm_path, prepared)
    if not pcm or len(pcm) % 2:
        raise ValueError("PCM must contain complete signed-16-bit samples")
    duration = len(pcm) / 32000
    prepared_duration = EVALUATOR.finite(prepared["durationSeconds"], "Prepared PCM duration")
    if abs(duration - prepared_duration) > 1e-9:
        raise ValueError("Prepared duration disagrees with the PCM byte count")
    with wave.open(io.BytesIO(audio), "rb") as source:
        sample_rate = source.getframerate()
        source_duration = source.getnframes() / sample_rate
    if abs(duration - source_duration) > max(1 / 16000, 1 / sample_rate) + 1e-9:
        raise ValueError("PCM and pinned WAV durations differ by more than one resampling sample")
    if abs(duration - reference_duration) > 0.02:
        raise ValueError("PCM and complete reference durations differ by more than 20 ms")
    evidence = {"audio": audio_hash, "annotation": annotation_hash, "pcm": pcm_hash,
                "sourceSeconds": source_duration, "pcmSeconds": duration,
                "referenceSeconds": reference_duration, "referenceNoteCount": len(reference),
                "pcmFormat": {"sampleRate": 16000, "channels": 1, "encoding": "s16le"}}
    return reference, pcm_path, duration, evidence


def score_output(output, reference, pcm_duration):
    notes, duration = EVALUATOR.prediction_notes(output)
    if output["noteEventsTruncated"]:
        raise ValueError("The full-recording comparison cannot use truncated note output")
    if abs(duration - pcm_duration) > 1e-6:
        raise ValueError("Native duration disagrees with the complete PCM input")
    return EVALUATOR.score_notes(reference, notes)


def run_track(probe, output_dir, record, validated):
    reference, pcm_path, duration, _ = validated
    directory = output_dir / record["track"]
    directory.mkdir()
    current_path, baseline_path = directory / "current.json", directory / "baseline.json"
    started = time.perf_counter()
    try:
        with current_path.open("xb") as stdout, (directory / "probe.stderr.txt").open("xb") as stderr:
            subprocess.run([str(probe), str(pcm_path), "--baseline-notes", str(baseline_path)],
                           stdout=stdout, stderr=stderr, check=True, timeout=120)
        record["hostProbeWallSeconds"] = time.perf_counter() - started
        current_bytes, current_hash = file_evidence(current_path)
        baseline_bytes, baseline_hash = file_evidence(baseline_path)
        current, baseline = read_json(current_bytes), read_json(baseline_bytes)
        for key in ("engine", "duration", "key", "tempo", "segments"):
            if current[key] != baseline[key]:
                raise ValueError("The shared-inference outputs disagree on " + key)
        scores = {"current": score_output(current, reference, duration),
                  "baseline": score_output(baseline, reference, duration)}
        record.update({"status": "complete", "outputs": {"current": current_hash, "baseline": baseline_hash},
                       "current": {key: scores["current"][key] for key in CRITERIA},
                       "baseline": {key: scores["baseline"][key] for key in CRITERIA}})
        record["delta"] = {key: differences(record["current"][key], record["baseline"][key])
                           for key in CRITERIA}
        report = {**record, "scores": scores}
    except Exception as error:
        record.update({"status": "failed", "hostProbeWallSeconds": time.perf_counter() - started,
                       "error": {"type": type(error).__name__, "message": str(error)}})
        # Retain partial/invalid output bytes and stderr for every failed recording.
        record["outputs"] = {path.name: file_evidence(path)[1]
                             for path in (current_path, baseline_path, directory / "probe.stderr.txt")
                             if path.exists()}
        report = dict(record)
    write_json(directory / "report.json", report)
    record["report"] = record["track"] + "/report.json"


def provenance(probe, manifest_bytes, prepared_bytes):
    frozen = BASELINE_SOURCE.read_bytes()
    blob = hashlib.sha1(b"blob " + str(len(frozen)).encode() + b"\0" + frozen).hexdigest()
    if blob != BASELINE_BLOB:
        raise ValueError("Frozen baseline decoder differs from the declared Git blob")
    source_paths = [Path(__file__).resolve(), Path(SPEC.origin), BASELINE_SOURCE,
                    REPO / "scripts/fetch-offline-chord-quality-fixtures.py",
                    REPO / "scripts/fetch-offline-chord-fixtures.py",
                    REPO / "android/song-fingerprint/src/note_events.rs",
                    REPO / "android/song-fingerprint/src/chord_notes.rs",
                    REPO / "android/song-fingerprint/src/chords.rs",
                    REPO / "android/song-fingerprint/src/bin/chord_probe.rs",
                    REPO / "android/song-fingerprint/Cargo.lock"]
    return {"baselineCommit": BASELINE_COMMIT, "baselineDecoderGitBlob": blob,
            "sourceManifest": str(MANIFEST.relative_to(REPO)), "sourceManifestSha256": sha256(manifest_bytes),
            "preparedInputsSha256": sha256(prepared_bytes), "nativeBinarySha256": sha256(probe.read_bytes()),
            "sources": {str(path.relative_to(REPO)): sha256(path.read_bytes()) for path in source_paths},
            "pythonVersion": platform.python_version(),
            "github": {key: os.environ.get(key) for key in
                       ("GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_EVENT_NAME", "GITHUB_HEAD_REF")}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--probe", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.input_dir, args.probe, args.output_dir = (value.resolve() for value in
                                                (args.input_dir, args.probe, args.output_dir))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if any(args.output_dir.iterdir()):
        raise ValueError("Use an empty output directory; prior evidence is never overwritten")
    records, inputs = [], {}
    summary = {"schemaVersion": 1, "scope": "Development comparison on twelve previously used GuitarSet takes; "
               "not held-out performance, independent songs, full-mix accuracy, or technique classification.",
               "trainingOverlap": "GuitarSet was used in Basic Pitch training; exact checkpoint track overlap is unverified.",
               "protocol": {"onsetToleranceSeconds": EVALUATOR.ONSET_TOLERANCE,
                            "pitchToleranceMidi": EVALUATOR.PITCH_TOLERANCE,
                            "offsetMinimumSeconds": EVALUATOR.OFFSET_MINIMUM,
                            "offsetReferenceDurationRatio": EVALUATOR.OFFSET_RATIO,
                            "matching": "Independent maximum one-to-one matching for each criterion and recording.",
                            "denominators": "Every reference note and every prediction; no cropping, alignment, pitch filtering or deduplication.",
                            "aggregation": "Sum counts across all declared recordings, then calculate precision/recall/F1; never average per-track F1.",
                            "delta": "Current minus frozen baseline; negative precision/recall/F1 is listed as a regression.",
                            "inference": "One probe invocation and one model pass per recording; both note decoders consume the same frames.",
                            "timing": "Single host process wall time includes inference, both note decoders and output; not phone latency.",
                            "accuracyGate": None}, "records": records}
    try:
        manifest_bytes = MANIFEST.read_bytes()
        manifest = read_json(manifest_bytes)
        fixtures, tracks = manifest["fixtures"], manifest["tracks"]
        if len(tracks) != 12 or len(set(tracks)) != 12 or [item["track"] for item in fixtures] != tracks:
            raise ValueError("Expected all twelve unique declared tracks in manifest order")
        records.extend({"track": track, "status": "notRun"} for track in tracks)
        summary["dataset"] = {key: manifest[key] for key in ("dataset", "source", "license", "authors")}
        prepared_bytes = (args.input_dir / "prepared-inputs.json").read_bytes()
        prepared = read_json(prepared_bytes)
        if prepared["sourceManifestSha256"] != sha256(manifest_bytes):
            raise ValueError("Prepared PCM belongs to a different fixture manifest")
        pcm_records = prepared["pcm"]
        if len(pcm_records) != 12 or {item["track"] for item in pcm_records} != set(tracks):
            raise ValueError("Prepared PCM must identify every declared track exactly once")
        pcm_by_track = {item["track"]: item for item in pcm_records}
        summary["provenance"] = provenance(args.probe, manifest_bytes, prepared_bytes)
        for record, fixture in zip(records, fixtures):
            try:
                validated = validate_track(fixture, pcm_by_track[record["track"]], args.input_dir)
                record["inputs"] = validated[3]
                inputs[record["track"]] = validated
            except Exception as error:
                record.update({"status": "invalidInput", "error": {
                    "type": type(error).__name__, "message": str(error)}})
        # Validate the entire declared corpus before spending any inference work.
        if len(inputs) == len(records):
            for record in records:
                run_track(args.probe, args.output_dir, record, inputs[record["track"]])
                print(json.dumps({key: record[key] for key in ("track", "status")}), flush=True)
        else:
            summary["error"] = "No inference ran because one or more declared inputs failed validation."
    except Exception as error:
        summary["error"] = {"type": type(error).__name__, "message": str(error)}
    summary["completedRecordings"] = sum(record["status"] == "complete" for record in records)
    summary["declaredRecordings"] = 12
    summary["comparison"] = comparison(records, summary.get("error"))
    write_json(args.output_dir / "summary.json", summary)
    print("NOTE_CORPUS_COMPARISON_BEGIN")
    print(json.dumps(summary, indent=2, allow_nan=False))
    print("NOTE_CORPUS_COMPARISON_END")
    return 0 if summary["comparison"]["complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
