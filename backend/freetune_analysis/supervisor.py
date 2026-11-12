import asyncio
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

import psutil
from filelock import FileLock, Timeout

from .config import Settings
from .store import JobStore, TERMINAL


class Supervisor:
    """One memory-bounded model process at a time; the API never runs inference."""

    def __init__(self, settings: Settings, store: JobStore):
        self.settings, self.store = settings, store
        self.process = None
        self.active_id = None
        self.task = None
        self.lock = asyncio.Lock()
        self.stopping = False
        self.service_lock = FileLock(str(settings.data_dir / "service.lock"))

    async def start(self):
        self.settings.jobs_dir.mkdir(parents=True, exist_ok=True)
        try:
            self.service_lock.acquire(timeout=0)
        except Timeout:
            raise RuntimeError("Another FreeTune server already owns FREETUNE_DATA_DIR") from None
        self.store.interrupt_running()
        for temporary in self.settings.jobs_dir.glob("upload-*.part"):
            temporary.unlink(missing_ok=True)
        # Results remain in SQLite; no server-side audio is needed for retry (client reuploads).
        for directory in self.settings.jobs_dir.iterdir():
            if directory.is_dir():
                shutil.rmtree(directory, ignore_errors=True)
        self.task = asyncio.create_task(self.run())

    async def stop(self):
        self.stopping = True
        if self.active_id:
            self.store.update(self.active_id, status="interrupted", stage="interrupted", progress=0,
                              error="server_stopped")
        await self.kill()
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        self.service_lock.release()

    async def kill(self):
        process = self.process
        if not process or process.poll() is not None:
            return
        try:
            parent = psutil.Process(process.pid)
            children = parent.children(recursive=True)
            for child in children:
                try:
                    child.terminate()
                except psutil.NoSuchProcess:
                    pass
            parent.terminate()
            _, alive = await asyncio.to_thread(psutil.wait_procs, children + [parent], 2)
            for child in alive:
                try:
                    child.kill()
                except psutil.NoSuchProcess:
                    pass
        except psutil.NoSuchProcess:
            pass

    async def cancel(self, job_id):
        row = self.store.get(job_id)
        if row is None:
            return None
        if row["status"] in {"queued", "running"}:
            self.store.update(job_id, status="cancelled", stage="cancelled", progress=row["progress"])
            if self.active_id == job_id:
                await self.kill()
                # Don't acknowledge cancellation while the previous worker still owns its directory.
                for _ in range(60):
                    if self.active_id != job_id:
                        break
                    await asyncio.sleep(0.05)
        # A DELETE after a completed result is the client's acknowledgement + audio cleanup.
        self.cleanup(job_id)
        return self.store.get(job_id)

    def cleanup(self, job_id):
        shutil.rmtree(self.settings.jobs_dir / job_id, ignore_errors=True)

    def read_state(self, job_id):
        try:
            payload = json.loads((self.settings.jobs_dir / job_id / "state.json").read_text("utf-8"))
            if payload["status"] in TERMINAL | {"running"}:
                return payload
        except (OSError, ValueError, KeyError):
            pass
        return None

    def apply_state(self, job_id, state, peak):
        result = state.get("result")
        if result:
            metrics = result.setdefault("metrics", {})
            metrics["peakRssMb"] = max(float(metrics.get("peakRssMb", 0)), round(peak / 1024**2, 2))
        self.store.update(job_id, status=state["status"], stage=state["stage"],
                          progress=state["progress"], error=state.get("error"), result=result)

    async def execute(self, row):
        directory = self.settings.jobs_dir / row["id"]
        self.active_id = row["id"]
        self.store.update(row["id"], status="running", stage="starting", progress=0.01)
        environment = os.environ.copy()
        environment.update({
            "FREETUNE_DATA_DIR": str(self.settings.data_dir),
            "FREETUNE_WHISPER_MODEL": self.settings.whisper_model,
            "FREETUNE_WHISPER_PATH": str(self.settings.model_path),
            "FREETUNE_DEVICE": self.settings.device,
            "FREETUNE_COMPUTE_TYPE": self.settings.compute_type,
            "FREETUNE_CPU_THREADS": str(self.settings.cpu_threads),
            "FREETUNE_MAX_DURATION_SECONDS": str(self.settings.max_duration_seconds),
            "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
        })
        started, peak, last_state = time.monotonic(), 0, None
        reason = None
        try:
            with (directory / "worker.log").open("w", encoding="utf-8") as log:
                self.process = subprocess.Popen([
                    sys.executable, "-m", "freetune_analysis.worker", "--directory", str(directory),
                    "--input", str(directory / f"input{row['extension']}"), "--language", row["language"],
                    "--supervisor-pid", str(os.getpid()),
                    "--supervisor-created", str(psutil.Process().create_time()),
                ], cwd=Path(__file__).resolve().parents[1], env=environment,
                   stdout=log, stderr=log, start_new_session=os.name != "nt")
                while self.process.poll() is None and not self.stopping:
                    try:
                        parent = psutil.Process(self.process.pid)
                        memory = parent.memory_info().rss
                        for child in parent.children(recursive=True):
                            try:
                                memory += child.memory_info().rss
                            except psutil.NoSuchProcess:
                                pass
                        peak = max(peak, memory)
                    except psutil.NoSuchProcess:
                        pass
                    state = self.read_state(row["id"])
                    if state:
                        last_state = state
                        if state["status"] == "running":
                            self.apply_state(row["id"], state, peak)
                    if peak > self.settings.max_rss_mb * 1024**2:
                        reason = "memory_limit_exceeded"
                    elif time.monotonic() - started > self.settings.max_job_seconds:
                        reason = "analysis_timeout"
                    if reason:
                        await self.kill()
                        break
                    await asyncio.sleep(0.25)
                last_state = self.read_state(row["id"]) or last_state
                current = self.store.get(row["id"])
                if current["status"] not in {"running", "queued"}:
                    return
                if not reason and last_state and last_state["status"] in TERMINAL:
                    self.apply_state(row["id"], last_state, peak)
                else:
                    result = last_state.get("result") if last_state else None
                    useful = result and (result.get("chords") or result.get("lyrics"))
                    reason = reason or "worker_failed"
                    if result:
                        result["warnings"] = sorted(set(result.get("warnings", []) + [reason]))
                        metrics = result.setdefault("metrics", {})
                        metrics["peakRssMb"] = max(metrics.get("peakRssMb", 0), round(peak / 1024**2, 2))
                        metrics["elapsedSeconds"] = round(time.monotonic() - started, 3)
                    self.store.update(row["id"], status="partial" if useful else "failed", stage="done",
                                      progress=1, error=reason, result=result)
        except (OSError, ValueError):
            self.store.update(row["id"], status="failed", stage="failed", progress=0, error="worker_start_failed")
        finally:
            await self.kill()
            self.process, self.active_id = None, None
            finished = self.store.get(row["id"])
            if finished and finished["status"] in {"failed", "partial"}:
                try:
                    with (directory / "worker.log").open("rb") as error_log:
                        error_log.seek(max(0, error_log.seek(0, 2) - 8192))
                        logging.warning("Analysis %s: %s\n%s", row["id"], finished["status"],
                                        error_log.read().decode("utf-8", errors="replace"))
                except OSError:
                    pass
            self.cleanup(row["id"])

    async def run(self):
        while not self.stopping:
            for job_id in self.store.expired(time.time() - self.settings.retention_hours * 3600):
                self.cleanup(job_id)
                self.store.delete(job_id)
            row = self.store.queued()
            if row:
                await self.execute(row)
            else:
                await asyncio.sleep(0.25)
