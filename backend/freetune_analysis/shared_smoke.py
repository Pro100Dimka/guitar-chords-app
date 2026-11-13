"""A real-model, localhost TCP smoke of the shared service.

Run explicitly on an original MP3/WAV/M4A only when inference resources are free.
It creates two real installations, runs the installed models, checks isolation,
retry/cancellation/cleanup and result survival across a server restart. It never
publishes a service or claims a phone/recognition-quality measurement.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid

import httpx

from .config import MODEL_REVISIONS, Settings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--language", choices=("en", "uk", "ru", "auto"), default="en")
    parser.add_argument("--timeout", type=float, default=900)
    args = parser.parse_args()
    source, output = args.audio.resolve(), args.output.resolve()
    if not source.is_file() or source.suffix.lower() not in {".mp3", ".wav", ".m4a"}:
        parser.error("Supply an existing original MP3, WAV or M4A recording")
    if any(path.exists() for path in (output, output.with_name(output.stem + "-result.json"),
                                     output.with_name(output.stem + "-job.json"))):
        parser.error("Evidence output exists; choose a new path instead of overwriting a previous run")
    baseline = Settings.from_env()
    output.parent.mkdir(parents=True, exist_ok=True)
    with source.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    report = {"schemaVersion": 1, "status": "running", "transport": "real localhost TCP",
              "inference": "real installed models; no mocked model or API", "publicServiceDeployed": False,
              "physicalAndroidTested": False, "sourceSha256": digest, "sourceBytes": source.stat().st_size,
              "language": args.language, "model": baseline.whisper_model, "cpuThreads": baseline.cpu_threads,
              "checks": {}, "transitions": []}
    package = Path(__file__).resolve().parent
    report["sourceCodeSha256"] = {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                                  for path in sorted(package.glob("*.py"))}
    report["modelRevision"] = MODEL_REVISIONS[baseline.whisper_model][1]
    report["packageVersions"] = {name: importlib.metadata.version(name) for name in
                                 ("fastapi", "starlette", "python-multipart", "faster-whisper", "lv-chordia")}
    process = None
    temporary = None
    started = time.monotonic()

    def require(name, condition):
        report["checks"][name] = bool(condition)
        if not condition:
            raise RuntimeError("Smoke check failed: " + name)

    def stop_server():
        nonlocal process
        if process is None:
            return
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                if os.name == "posix":
                    os.killpg(process.pid, signal.SIGKILL)
                else:
                    process.kill()
                process.wait(timeout=5)
        process = None

    try:
        temporary = tempfile.TemporaryDirectory(prefix="shared-smoke-", dir=output.parent)
        runtime = Path(temporary.name)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        environment = os.environ.copy()
        environment.update({"FREETUNE_SERVICE_MODE": "shared", "FREETUNE_API_TOKEN": "",
                            "FREETUNE_DATA_DIR": str(runtime),
                            "FREETUNE_WHISPER_PATH": str(baseline.model_path),
                            "FREETUNE_INSTALLATION_TTL_DAYS": "90", "FREETUNE_RETENTION_HOURS": "24",
                            "FREETUNE_TRUSTED_PROXY_IPS": "", "HF_HUB_OFFLINE": "1",
                            "TRANSFORMERS_OFFLINE": "1"})

        def start_server():
            nonlocal process
            process = subprocess.Popen([sys.executable, "-m", "freetune_analysis", "--port", str(port)],
                                       cwd=Path(__file__).resolve().parents[1], env=environment,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       start_new_session=os.name == "posix")
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("Shared server exited before readiness")
                try:
                    health = httpx.get(base + "/health", timeout=5, trust_env=False)
                    if health.status_code == 200:
                        return health.json()
                except httpx.TransportError:
                    pass
                time.sleep(0.2)
            raise RuntimeError("Shared server did not expose health within 60 seconds")

        health = start_server()
        report["health"] = health
        require("shared_ready", health["ready"] and health["serviceMode"] == "shared" and health["authentication"] == "installation")
        with httpx.Client(base_url=base, timeout=310, trust_env=False) as client:
            require("anonymous_job_rejected", client.post("/v1/jobs", content=b"invalid").status_code == 401)
            a = client.post("/v1/installations")
            b = client.post("/v1/installations")
            require("two_installations", a.status_code == b.status_code == 201)
            a, b = a.json(), b.json()
            auth_a, auth_b = {"Authorization": "Bearer " + a["token"]}, {"Authorization": "Bearer " + b["token"]}
            require("distinct_random_access", a["token"] != b["token"] and len(a["token"]) == len(b["token"]) == 68)
            key = "smoke-" + uuid.uuid4().hex

            def upload(auth, request_key):
                with source.open("rb") as audio:
                    response = client.post("/v1/jobs", headers=auth,
                                           files={"file": ("input" + source.suffix.lower(), audio)},
                                           data={"language": args.language, "idempotency_key": request_key,
                                                 "audio_sha256": digest})
                require("upload_accepted_" + str(len(report["checks"])), response.status_code == 202)
                return response.json()

            job = upload(auth_a, key)
            require("retry_reuses_job", upload(auth_a, key)["id"] == job["id"])
            path = "/v1/jobs/" + job["id"]
            require("foreign_get_404", client.get(path, headers=auth_b).status_code == 404)
            require("foreign_delete_404", client.delete(path, headers=auth_b).status_code == 404)
            other = upload(auth_b, key)
            require("keys_are_tenant_scoped", other["id"] != job["id"])
            cancelled = client.delete("/v1/job-requests/" + key, headers=auth_b)
            require("second_tenant_cancelled", cancelled.status_code == 200 and cancelled.json()["jobStatus"] == "cancelled")
            require("cancelled_audio_deleted", not (runtime / "jobs" / other["id"]).exists())
            poll_started = time.monotonic()
            while time.monotonic() - poll_started < args.timeout:
                response = client.get(path, headers=auth_a)
                if response.status_code in {429, 503}:
                    time.sleep(min(60, max(1, int(response.headers.get("Retry-After", "1")))))
                    continue
                response.raise_for_status()
                current = response.json()
                state = [current["status"], current["stage"]]
                if not report["transitions"] or report["transitions"][-1]["state"] != state:
                    report["transitions"].append({"atSeconds": round(time.monotonic() - started, 3), "state": state})
                if current["status"] not in {"queued", "running"}:
                    break
                time.sleep(1)
            else:
                raise RuntimeError("Shared model result timed out")
            require("real_analysis_completed", current["status"] == "completed")
            result = current["result"]
            require("original_identity_preserved", current["audio_sha256"] == digest and current["idempotency_key"] == key)
            require("real_lyrics_and_chords", bool(result.get("lyrics")) and bool(result.get("chords")))
            deadline = time.monotonic() + 5
            while (runtime / "jobs" / job["id"]).exists() and time.monotonic() < deadline:
                time.sleep(0.05)
            require("terminal_audio_deleted", not (runtime / "jobs" / job["id"]).exists())
            acknowledged = client.delete(path, headers=auth_a)
            require("completed_delete_keeps_result", acknowledged.status_code == 200 and acknowledged.json()["result"] == result)
            require("result_can_be_retrieved_again", client.get(path, headers=auth_a).json()["result"] == result)
            with sqlite3.connect(runtime / "jobs.sqlite3") as db:
                hashes = {row[0] for row in db.execute("SELECT token_hash FROM installations")}
                require("server_stores_token_hashes_only", hashes == {
                    hashlib.sha256(a["token"].encode()).hexdigest(), hashlib.sha256(b["token"].encode()).hexdigest()})
                require("no_audio_or_upload_reservations", db.execute("SELECT count(*) FROM uploads").fetchone()[0] == 0
                        and db.execute("SELECT count(*) FROM jobs WHERE audio_pending<>0 OR storage_bytes<>0").fetchone()[0] == 0)
            report["resultSummary"] = {"duration": result.get("duration"), "lyricLines": len(result.get("lyrics", [])),
                                       "chords": len(result.get("chords", [])), "warnings": result.get("warnings", []),
                                       "metrics": result.get("metrics", {})}
            result_path = output.with_name(output.stem + "-result.json")
            result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", "utf-8")
            report["resultFile"] = result_path.name
            job_path = output.with_name(output.stem + "-job.json")
            job_path.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", "utf-8")
            report["jobFile"] = job_path.name
            stop_server()
            require("restart_ready", start_server()["ready"])
            require("same_access_and_result_survive_restart", client.get(path, headers=auth_a).json()["result"] == result)
        stop_server()
        report["status"] = "passed"
    except Exception as exc:
        report["status"] = "failed"
        report["failure"] = str(exc)
        raise
    finally:
        stop_server()
        if temporary is not None:
            temporary.cleanup()
        report["elapsedSeconds"] = round(time.monotonic() - started, 3)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
        print(json.dumps({"status": report["status"], "checks": len(report["checks"]), "report": str(output)}))


if __name__ == "__main__":
    main()
