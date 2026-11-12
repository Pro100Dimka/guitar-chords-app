"""Reproducible, real HTTP upload/inference benchmark against supplied human references."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import socket
import statistics
import subprocess
import sys
import time
import unicodedata
import uuid

import httpx

from .config import Settings


def tokens(text):
    normalized = unicodedata.normalize("NFKC", text).lower().replace("’", "'")
    return re.findall(r"[^\W_]+(?:'[^\W_]+)*|…", normalized, re.UNICODE)


def word_alignment(reference, hypothesis):
    """Levenshtein alignment: substitution, insertion, deletion each cost one."""
    n, m = len(reference), len(hypothesis)
    costs = [list(range(m + 1))]
    for i in range(1, n + 1):
        row = [i] + [0] * m
        previous = costs[-1]
        for j in range(1, m + 1):
            row[j] = min(previous[j] + 1, row[j - 1] + 1,
                         previous[j - 1] + (reference[i - 1] != hypothesis[j - 1]))
        costs.append(row)
    matches, i, j = [], n, m
    while i or j:
        if i and j and costs[i][j] == costs[i - 1][j - 1] + (reference[i - 1] != hypothesis[j - 1]):
            if reference[i - 1] == hypothesis[j - 1] and reference[i - 1] != "…":
                matches.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif i and costs[i][j] == costs[i - 1][j] + 1:
            i -= 1
        else:
            j -= 1
    return costs[n][m], list(reversed(matches))


def lyrics_metrics(reference, result):
    predicted_text = "\n".join(line["text"] for line in result.get("lyrics", []))
    ref_tokens, hyp_tokens = tokens(reference.get("text", "")), tokens(predicted_text)
    edits, _ = word_alignment(ref_tokens, hyp_tokens)
    # Use word-annotated text separately: Jam-ALT's corrected transcript has no word timings.
    ref_words = reference.get("words", [])
    hyp_words = [word for line in result.get("lyrics", []) for word in line.get("words", [])]
    ref_flat = [(token, word) for word in ref_words for token in tokens(word["text"])]
    hyp_flat = [(token, word) for word in hyp_words for token in tokens(word["text"])]
    _, matches = word_alignment([x[0] for x in ref_flat], [x[0] for x in hyp_flat])
    starts, ends = [], []
    for r, h in matches:
        a, b = ref_flat[r][1], hyp_flat[h][1]
        if a.get("start") is not None:
            starts.append(abs(a["start"] - b["start"]))
        if a.get("end") is not None:
            ends.append(abs(a["end"] - b["end"]))
    return {"referenceWords": len(ref_tokens), "predictedWords": len(hyp_tokens), "wordErrors": edits,
            "wer": edits / len(ref_tokens) if ref_tokens else None,
            "uncertainWords": sum(word.get("uncertain", False) for word in hyp_words),
            "alignmentReferenceWords": len(ref_flat), "alignedExactWords": len(matches),
            "matchedWordStartMaeSeconds": statistics.mean(starts) if starts else None,
            "matchedWordEndMaeSeconds": statistics.mean(ends) if ends else None,
            "chordAccuracy": None}


def run_job(client, server, audio: Path, language, key):
    with audio.open("rb") as handle:
        sha = hashlib.file_digest(handle, "sha256").hexdigest()
    with audio.open("rb") as handle:
        response = client.post(server + "/v1/jobs", files={"file": (audio.name, handle)}, data={
            "language": language, "idempotency_key": key, "audio_sha256": sha})
    response.raise_for_status()
    job = response.json()
    deadline = time.monotonic() + 7200
    while job["status"] in {"queued", "running"}:
        if time.monotonic() > deadline:
            client.delete(server + "/v1/jobs/" + job["id"])
            raise RuntimeError("benchmark_timeout")
        time.sleep(0.5)
        response = client.get(server + "/v1/jobs/" + job["id"])
        response.raise_for_status()
        job = response.json()
    assert job["audio_sha256"] == sha and job["idempotency_key"] == key
    return job


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, default=Path("data/evaluation/report.json"))
    parser.add_argument("--server", help="Your analysis server. Omit to start a local test server.")
    parser.add_argument("--count", type=int)
    parser.add_argument("--resume", action="store_true", help="Keep completed results after an interrupted benchmark")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text("utf-8"))
    records = manifest["recordings"][:args.count] if args.count else manifest["recordings"]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    server_process, log = None, None
    if not args.server:
        with socket.socket() as finder:
            finder.bind(("127.0.0.1", 0))
            port = finder.getsockname()[1]
        server = f"http://127.0.0.1:{port}"
        log = args.output.with_suffix(".server.log").open("w")
        environment = os.environ.copy()
        # Independent benchmarks must not share/interrupt the user's persistent jobs.
        environment["FREETUNE_WHISPER_PATH"] = str(Settings.from_env().model_path)
        environment["FREETUNE_DATA_DIR"] = str((args.output.parent / "runtime-data").resolve())
        server_process = subprocess.Popen([sys.executable, "-m", "freetune_analysis", "--port", str(port)],
                                          stdout=log, stderr=log, env=environment)
    else:
        server = args.server.rstrip("/")
    print(f"Uploading evaluation recordings to {server}", flush=True)
    token = os.getenv("FREETUNE_API_TOKEN")
    headers = {"Authorization": "Bearer " + token} if token else {}
    report = {"platform": platform.platform(), "cpuCount": os.cpu_count(), "physicalAndroid": False,
              "corpus": manifest.get("corpus"), "measurements": [],
              "limitations": ["No physical Android hardware was measured.",
                              "Chord accuracy requires a separate human chord reference.",
                              "Word MAE is computed only on exact text matches; see matched coverage.",
                              "Ellipsis uncertainty markers count as incorrect words in WER."]}
    try:
        if args.resume and args.output.exists():
            previous = json.loads(args.output.read_text("utf-8"))
            if previous.get("corpus") != report["corpus"]:
                raise ValueError("Cannot resume a different corpus/revision")
            report["measurements"] = [row for row in previous["measurements"] if row["status"] == "completed"]
        with httpx.Client(timeout=180, trust_env=False, headers=headers) as client:
            for _ in range(80):
                try:
                    health = client.get(server + "/health")
                    health.raise_for_status()
                    if not health.json()["ready"]:
                        raise RuntimeError("Models are not installed. Run setup_models first.")
                    break
                except httpx.HTTPError:
                    time.sleep(0.25)
            else:
                raise RuntimeError("Analysis server did not start")
            expected_model = health.json()["models"]["lyrics"]["name"]
            report["models"] = health.json()["models"]
            completed = {row["id"] for row in report["measurements"]}
            for index, record in enumerate(records):
                audio = (args.manifest.parent / record["audio"]).resolve()
                if record["id"] in completed:
                    saved = json.loads((args.output.parent / (record["id"] + ".analysis.json")).read_text("utf-8"))
                    with audio.open("rb") as handle:
                        sha = hashlib.file_digest(handle, "sha256").hexdigest()
                    if saved["audio_sha256"] != sha or saved["result"]["model"]["lyrics"] != expected_model:
                        raise ValueError("Cannot resume changed audio/model: " + record["id"])
                    continue
                reference = (json.loads((args.manifest.parent / record["reference"]).read_text("utf-8"))
                             if record.get("reference") else None)
                begin = time.monotonic()
                job = run_job(client, server, audio, record["language"], "benchmark-" + uuid.uuid4().hex)
                result = job.get("result") or {}
                output = args.output.parent / (record["id"] + ".analysis.json")
                write_json(output, job)
                measured = {"id": record["id"], "language": record["language"], "status": job["status"],
                            "durationSeconds": result.get("duration"), "wallSeconds": round(time.monotonic() - begin, 3),
                            "detectedLanguage": result.get("language"),
                            "lyricLines": len(result.get("lyrics", [])),
                            "chordIntervals": len(result.get("chords", [])),
                            "humanReferenceAvailable": reference is not None,
                            "warnings": result.get("warnings", []), "error": job.get("error"),
                            **result.get("metrics", {}), **lyrics_metrics(reference or {}, result)}
                incomplete = {"lyrics_failed", "lyrics_model_not_installed", "worker_failed",
                              "analysis_timeout", "memory_limit_exceeded", "server_restarted"}
                if (reference is None or job["status"] not in {"completed", "partial"} or
                        incomplete.intersection(measured["warnings"])):
                    # A crashed/incomplete recognizer is a reliability failure, not a measured WER.
                    measured.update(wer=None, wordErrors=None, matchedWordStartMaeSeconds=None,
                                    matchedWordEndMaeSeconds=None)
                report["measurements"].append(measured)
                report["summary"] = summarize(report["measurements"])
                write_json(args.output, report)
                client.delete(server + "/v1/jobs/" + job["id"]).raise_for_status()
                print(f"{index + 1}/{len(records)} {record['id']}: {job['status']}, "
                      f"{measured['wallSeconds']}s, WER={measured['wer']}", flush=True)
    finally:
        if server_process:
            server_process.terminate()
            try:
                server_process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server_process.kill()
        if log:
            log.close()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), "utf-8")
    temporary.replace(path)


def summarize(rows):
    scored = [row for row in rows if row["wordErrors"] is not None]
    words = sum(row["referenceWords"] for row in scored)
    return {"recordings": len(rows), "languages": sorted({row["language"] for row in rows}),
            "completed": sum(row["status"] == "completed" for row in rows),
            "partial": sum(row["status"] == "partial" for row in rows),
            "failed": sum(row["status"] not in {"completed", "partial"} for row in rows),
            "scoredLyricsRecordings": len(scored),
            "wer": sum(row["wordErrors"] for row in scored) / words if words else None,
            "totalAudioSeconds": sum(row.get("durationSeconds") or 0 for row in rows),
            "totalWallSeconds": sum(row["wallSeconds"] for row in rows),
            "maximumPeakRssMb": max((row.get("peakRssMb", 0) for row in rows), default=0)}


if __name__ == "__main__":
    main()
