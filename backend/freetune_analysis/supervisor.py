import asyncio
import json
import logging
import os
from pathlib import Path
import re
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
        self.maintenance_task = None
        self.active_uploads = set()
        self.lock = asyncio.Lock()
        self.stopping = False
        self.service_lock = FileLock(str(settings.data_dir / "service.lock"))

    async def start(self):
        self.settings.jobs_dir.mkdir(parents=True, exist_ok=True)
        self.settings.jobs_dir.chmod(0o700)
        try:
            self.service_lock.acquire(timeout=0)
        except Timeout:
            raise RuntimeError("Another FreeTune server already owns FREETUNE_DATA_DIR") from None
        try:
            self.stopping = False
            # App construction and ASGI startup are separate: another version may
            # have migrated the idle directory between those two lock acquisitions.
            self.store.assert_current_schema()
            self.store.interrupt_running()
            self.maintain()
            self.task = asyncio.create_task(self.run())
            # Retention and failed deletions must continue during long native model work.
            self.maintenance_task = asyncio.create_task(self.maintenance_loop())
        except BaseException:
            self.service_lock.release()
            raise

    async def stop(self):
        self.stopping = True
        if self.active_id:
            self.store.update(self.active_id, status="interrupted", stage="interrupted", progress=0,
                              error="server_stopped")
        await self.kill()
        for task in (self.task, self.maintenance_task):
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        self.maintain()
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

    async def cancel(self, job_id, owner="private"):
        row = self.store.get(job_id, owner)
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
        if self.active_id != job_id:
            self.cleanup(job_id)
        return self.store.get(job_id, owner)

    def cleanup(self, job_id, *, result_expired=False):
        directory = self.settings.jobs_dir / job_id
        failed = False
        if result_expired:
            # The inactive worker may have persisted a second copy of its
            # result. Remove each copy even if deleting an audio file fails.
            for name in ("state.json", "state.tmp"):
                try:
                    (directory / name).unlink(missing_ok=True)
                except OSError:
                    failed = True
        try:
            if directory.exists():
                shutil.rmtree(directory)
        except OSError:
            failed = True
        if failed:
            # Keep the row and its storage/active-slot reservation until deletion succeeds.
            self.store.cleanup_failed(job_id, self.settings.max_upload_bytes + self.settings.decoded_reservation_bytes)
            logging.warning("Audio cleanup pending for job %s", job_id)
            return False
        self.store.cleaned(job_id)
        return True

    def cleanup_upload(self, identifier):
        try:
            directory = self.settings.jobs_dir / "uploads" / identifier
            marker = directory / "target-job"
            if marker.exists():
                target = marker.read_text("ascii")
                if not re.fullmatch(r"[a-f0-9]{32}", target):
                    return False
                row = self.store.record(target)
                # Active/published work owns its own reservation. Otherwise the
                # upload lease must clean the destination of a failed commit.
                if target != self.active_id and (row is None or row["status"] in TERMINAL):
                    if not self.cleanup(target):
                        return False
            if directory.exists():
                shutil.rmtree(directory)
        except OSError:
            return False
        self.store.release_upload(identifier)
        return True

    def maintain(self):
        cutoff = time.time() - self.settings.retention_hours * 3600
        # Erase expired result content independently; an undeletable audio file
        # must retain its cleanup row/quota, never extend API result retention.
        self.store.expire_results(cutoff)
        expired = set(self.store.expired(cutoff))
        for job_id in expired:
            if job_id != self.active_id and self.cleanup(job_id, result_expired=True):
                self.store.delete(job_id)
        for job_id in self.store.pending_cleanup():
            if job_id != self.active_id and job_id not in expired:
                self.cleanup(job_id)
        for identifier in self.store.pending_uploads():
            if identifier not in self.active_uploads:
                self.cleanup_upload(identifier)
        # Crash windows before a row commits can leave an unowned input directory.
        orphan_bytes = 0
        for path in self.settings.jobs_dir.iterdir():
            if path.name == "uploads" or path.name == self.active_id:
                continue
            if path.is_dir() and self.store.record(path.name):
                continue
            try:
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink(missing_ok=True)
            except OSError:
                orphan_bytes += self.settings.max_upload_bytes + self.settings.decoded_reservation_bytes
        self.store.account_orphans(orphan_bytes)
        self.store.maintain_metadata()

    async def maintenance_loop(self):
        while not self.stopping:
            self.maintain()
            await asyncio.sleep(1)

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
            "FREETUNE_SERVICE_MODE": self.settings.service_mode,
            "FREETUNE_API_TOKEN": "" if self.settings.service_mode == "shared" else self.settings.token,
            "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
        })
        started, peak, last_state = time.monotonic(), 0, None
        reason = None
        try:
            # Native exception messages may include source audio content or filenames.
            # Persist only structured error codes; never capture model stdout/stderr.
            with open(os.devnull, "w") as log:
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
                current = self.store.get(row["id"], owner=None)
                if current is None or current["status"] not in {"running", "queued"}:
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
            self.cleanup(row["id"])

    async def run(self):
        while not self.stopping:
            row = self.store.queued()
            if row:
                await self.execute(row)
            else:
                await asyncio.sleep(0.25)
