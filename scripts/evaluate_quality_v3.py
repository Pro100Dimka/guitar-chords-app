#!/usr/bin/env python3
"""Run actual full audio analysis and score same-native legacy/candidate adapters.

References are read by the parent scorer only, never passed to worker/model
processes. Outputs are checkpointed per recording and can be resumed only with
matching audio, source-code digest, model and thread configuration. Worker
limits apply to the two CPU subprocesses, not a speech-model service provider.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))


def sha256(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False,
                                    default=lambda value: value.item()) + "\n", "utf-8")
    temporary.replace(path)


def fingerprint():
    paths = [ROOT / "backend/freetune_analysis" / name for name in
             ("pipeline.py", "singing.py", "chords.py")]
    return {str(path.relative_to(ROOT)): sha256(path) for path in paths}


def worker(request):
    os.environ.update(OMP_NUM_THREADS=str(request["threads"]), MKL_NUM_THREADS=str(request["threads"]),
                      HF_HUB_OFFLINE="1", CUDA_VISIBLE_DEVICES="")
    from freetune_analysis import pipeline
    from freetune_analysis.config import Settings
    from freetune_analysis.singing import adapt_segment
    directory = Path(request["directory"])
    source = Path(request["audio"])
    if sha256(source) != request["audioSha256"] or fingerprint() != request["codeSha256"]:
        raise ValueError("Audio or code changed after evaluation was frozen")
    settings = Settings(data_dir=ROOT / "backend/data", whisper_model=request["model"],
                        cpu_threads=request["threads"])
    original_lyrics, original_chords = pipeline.recognize_lyrics, pipeline.recognize_chords
    native, legacy_lines, legacy_warnings, chord_evidence = [], [], [], []

    def observed_lyrics(audio, duration, language, settings, progress):
        def observe(segment, evidence):
            native.append({"segment": asdict(segment), "nativeWords": evidence})
            line, warnings = adapt_segment(segment, duration, evidence, legacy=True)
            if line:
                legacy_lines.append(line)
            legacy_warnings.extend(warnings)
        return original_lyrics(audio, duration, language, settings, progress, native_observer=observe)

    def observed_chords(audio, duration, settings):
        return original_chords(audio, duration, settings, observer=chord_evidence.append)

    pipeline.recognize_lyrics = observed_lyrics
    pipeline.recognize_chords = observed_chords
    final = {}

    def emit(state):
        nonlocal final
        final = {**state, "audio_sha256": request["audioSha256"],
                 "idempotency_key": "quality-v3-" + request["id"], "id": request["id"]}
        write_json(directory / "state.json", final)

    started = time.monotonic()
    try:
        result = pipeline.analyze(source, directory, request["language"], settings, emit)
    finally:
        pipeline.recognize_lyrics, pipeline.recognize_chords = original_lyrics, original_chords
    legacy_lines, unreliable = pipeline.disjoint_lyrics(legacy_lines)
    legacy_lines, omitted = pipeline.remove_non_lyric_captions(legacy_lines)
    if unreliable:
        legacy_warnings.append("word_timing_unreliable")
    if omitted:
        legacy_warnings.append("non_lyric_caption_omitted")
    if not legacy_lines:
        legacy_warnings.append("no_lyrics")
    lyric_codes = {"word_timing_unreliable", "lyrics_unreliable", "no_lyrics", "non_lyric_caption_omitted"}
    legacy = {**result, "lyrics": legacy_lines,
              "warnings": sorted(set(legacy_warnings + [code for code in result["warnings"] if code not in lyric_codes])),
              "model": {**result["model"], "alignment": "Legacy adapter replay on identical native segments",
                        "chords": "LV-Chordia1.1.0 original forced-N HMM replay on identical neural observations"}}
    legacy.pop("metrics", None)
    if chord_evidence:
        legacy["chords"] = pipeline.chord_intervals(chord_evidence[-1]["legacy"], result["duration"])
    write_json(directory / "native.json", {"referenceSuppliedToInference": False, "segments": native})
    write_json(directory / "legacy-result.json", legacy)
    write_json(directory / "measurement.json", {
        "request": request, "wallSeconds": time.monotonic() - started,
        "status": final["status"], "sameNativeAdapterReplay": True,
        "separateLegacyInferenceRuntimeMeasured": False,
        "nativeWords": sum(len(item["segment"].get("words") or []) for item in native),
        "nativeEvidenceMappedWords": sum(len(item["nativeWords"]) for item in native),
    })


def run_record(record, args, code_sha):
    directory = args.output / "results" / record["id"]
    directory.mkdir(parents=True, exist_ok=True)
    request = {"id": record["id"], "audio": record["audio"], "language": record["language"],
               "audioSha256": sha256(Path(record["audio"])), "model": args.model,
               "threads": args.threads, "seed": 0, "codeSha256": code_sha,
               "directory": str(directory.resolve())}
    expected = record.get("audioSha256") or record.get("sha256")
    if expected and expected != request["audioSha256"]:
        raise ValueError("Source checksum differs: " + record["id"])
    measured = directory / "measurement.json"
    if measured.exists():
        previous = json.loads(measured.read_text("utf-8"))
        if not args.resume or previous["request"] != request:
            raise ValueError("Existing result cannot be overwritten/reused with changed inputs: " + record["id"])
    else:
        request_path = directory / "request.json"
        write_json(request_path, request)
        with (directory / "worker.log").open("w") as log:
            subprocess.run([sys.executable, str(Path(__file__).resolve()), "--worker-request", str(request_path)],
                           stdout=log, stderr=log, check=True, timeout=3600)
    final = json.loads((directory / "state.json").read_text("utf-8"))
    legacy = json.loads((directory / "legacy-result.json").read_text("utf-8"))
    measurement = json.loads(measured.read_text("utf-8"))
    write_json(args.output / (record["id"] + ".analysis.json"), final)
    result = final.get("result") or {}
    from freetune_analysis.quality_metrics import paired_timing, score_lyrics
    reference = json.loads(Path(record["reference"]).read_text("utf-8")) if record.get("reference") else {}
    before, legacy_matches = score_lyrics(reference, legacy)
    after, candidate_matches = score_lyrics(reference, result)
    lyrics_failed = final["status"] not in {"completed", "partial"} or bool(
        {"lyrics_failed", "lyrics_model_not_installed", "analysis_timeout", "memory_limit_exceeded"}
        .intersection(result.get("warnings", [])))
    if lyrics_failed:
        # A missing/crashed recognizer is a reliability failure, not a WER run.
        for measured in (before, after):
            for key in ("wordErrors", "wer", "substitutions", "insertions", "deletions",
                        "markerAwareErrors", "markerAwareWer", "startMaeSeconds", "endMaeSeconds"):
                measured[key] = None
        legacy_matches, candidate_matches = {}, {}
    row = {"id": record["id"], "kind": record["kind"], "language": record["language"],
           "exposure": record["exposure"], "audioSha256": request["audioSha256"],
           "status": final["status"], "durationSeconds": result.get("duration"),
           "wallSeconds": measurement["wallSeconds"], "metrics": result.get("metrics"),
           "legacy": before, "candidate": after, "pairedTiming": paired_timing(legacy_matches, candidate_matches),
           "lyricLines": len(result.get("lyrics", [])), "chordIntervals": len(result.get("chords", [])),
           "warnings": result.get("warnings", []),
           "nativeWords": measurement["nativeWords"], "nativeEvidenceMappedWords": measurement["nativeEvidenceMappedWords"]}
    if record.get("chordReference"):
        from evaluate_guitarset import boundaries, canonical, score, triad
        chords = json.loads(Path(record["chordReference"]).read_text("utf-8"))
        row["chords"] = {}
        for name, analysis in (("legacy", legacy), ("candidate", result)):
            row["chords"][name] = {metric: score(chords["chords"], analysis["chords"], analysis["duration"], transform)
                                   for metric, transform in (("exact", canonical), ("triad", triad))}
            row["chords"][name]["boundaries"] = boundaries(chords["chords"], analysis["chords"], analysis["duration"])
    return row


def summary(rows):
    scored = [row for row in rows if row["candidate"]["wer"] is not None]
    result = {"recordings": len(rows), "completed": sum(row["status"] == "completed" for row in rows),
              "partial": sum(row["status"] == "partial" for row in rows),
              "audioSeconds": sum(row.get("durationSeconds") or 0 for row in rows),
              "sumJobWallSeconds": sum(row["wallSeconds"] for row in rows),
              "maximumWorkerPeakRssMiB": max((row.get("metrics", {}).get("peakRssMb", 0) for row in rows), default=0),
              "scoredRecordings": len(scored)}
    for adapter in ("legacy", "candidate"):
        counts = {key: sum(row[adapter][key] for row in scored) for key in
                  ("referenceWords", "wordErrors", "markerAwareErrors", "timingReferenceWords", "timedExactWords",
                   "startErrorSumSeconds", "endErrorSumSeconds", "coarseLines")}
        counts.update(wer=counts["wordErrors"] / counts["referenceWords"] if counts["referenceWords"] else None,
                      markerAwareWer=counts["markerAwareErrors"] / counts["referenceWords"] if counts["referenceWords"] else None,
                      timedExactCoverage=counts["timedExactWords"] / counts["timingReferenceWords"] if counts["timingReferenceWords"] else None,
                      startMaeSeconds=counts["startErrorSumSeconds"] / counts["timedExactWords"] if counts["timedExactWords"] else None,
                      endMaeSeconds=counts["endErrorSumSeconds"] / counts["timedExactWords"] if counts["timedExactWords"] else None)
        result[adapter] = counts
    common = sum(row["pairedTiming"]["sameReferenceWords"] for row in scored)
    result["pairedTiming"] = {"sameReferenceWords": common}
    for adapter in ("legacy", "candidate"):
        for boundary in ("Start", "End"):
            key = adapter + boundary
            total = sum(row["pairedTiming"][key + "ErrorSumSeconds"] for row in scored)
            result["pairedTiming"][key + "MaeSeconds"] = total / common if common else None
    negatives = [row for row in rows if row["kind"] == "instrumental"]
    result["instrumental"] = {"recordings": len(negatives),
                              "withLexicalLyrics": sum(row["candidate"]["predictedLexicalWords"] > 0 for row in negatives),
                              "lexicalWords": sum(row["candidate"]["predictedLexicalWords"] for row in negatives),
                              "newControls": sum(row["exposure"] == "new" for row in negatives)}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker-request", type=Path)
    parser.add_argument("--manifest", type=Path, nargs="*", default=[])
    parser.add_argument("--guitarset", type=Path, nargs="*", default=[])
    parser.add_argument("--output", type=Path)
    parser.add_argument("--model", choices=("small", "turbo"), default="small")
    parser.add_argument("--threads", type=int, choices=(2, 4), default=4)
    parser.add_argument("--workers", type=int, choices=(1, 2), default=2)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--only", nargs="*", help="Explicit IDs for a diagnostic/pilot subset")
    args = parser.parse_args()
    if args.worker_request:
        worker(json.loads(args.worker_request.read_text("utf-8")))
        return
    if not args.output:
        parser.error("--output is required")
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    records = []
    for manifest_path in args.manifest:
        manifest = json.loads(manifest_path.read_text("utf-8"))
        for item in manifest["recordings"]:
            records.append({**item, "audio": str((manifest_path.parent / item["audio"]).resolve()),
                            "reference": str((manifest_path.parent / item["reference"]).resolve()) if item.get("reference") else None,
                            "kind": "vocal", "exposure": "exposed-or-membership-uncertain"})
    for folder in args.guitarset:
        for path in sorted(folder.glob("*.reference.json")):
            item = json.loads(path.read_text("utf-8"))
            records.append({"id": item["name"], "audio": str((folder / (item["name"] + "_mic.wav")).resolve()),
                            "audioSha256": item["sha256"], "reference": None, "chordReference": str(path.resolve()),
                            "language": "en", "kind": "instrumental",
                            "exposure": "new" if item["name"].startswith("05_") else "exposed"})
    if args.only:
        selected = set(args.only)
        records = [record for record in records if record["id"] in selected]
        if {record["id"] for record in records} != selected:
            parser.error("One or more --only IDs are missing")
    if not records or len({record["id"] for record in records}) != len(records):
        parser.error("Evaluation requires nonempty unique recording IDs")
    code_sha = fingerprint()
    plan = {"schemaVersion": 3, "model": args.model, "seed": 0, "threads": args.threads,
            "workers": args.workers, "codeSha256": code_sha, "recordings": records}
    plan_path = args.output / "plan.json"
    if plan_path.exists() and json.loads(plan_path.read_text("utf-8")) != plan:
        raise ValueError("Existing evaluation plan differs; choose a new output directory")
    write_json(plan_path, plan)
    report = {"schemaVersion": 3, "platform": platform.platform(), "plan": plan,
              "referenceSuppliedToInference": False, "comparison": "Same-native legacy adapter and HMM replay, no second-inference runtime",
              "measurement": "At most2 concurrent CPU processes,4threads each; direct full pipeline, not HTTP or Android; shared host",
              "items": [], "failures": []}
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(run_record, record, args, code_sha): record for record in records}
        for future in as_completed(futures):
            record = futures[future]
            try:
                row = future.result()
                report["items"].append(row)
                print(json.dumps({"id": row["id"], "status": row["status"], "seconds": round(row["wallSeconds"], 2),
                                  "legacyWer": row["legacy"]["wer"], "candidateWer": row["candidate"]["wer"],
                                  "lexicalWords": row["candidate"]["predictedLexicalWords"]}), flush=True)
            except Exception as error:
                report["failures"].append({"id": record["id"], "error": str(error)})
                print(json.dumps(report["failures"][-1]), flush=True)
            report["items"].sort(key=lambda item: item["id"])
            report["summary"] = summary(report["items"])
            report["cohortWallSeconds"] = time.monotonic() - started
            write_json(args.output / "report.json", report)
    if report["failures"] or any(row["status"] != "completed" for row in report["items"]):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
