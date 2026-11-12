"""SQLite job state. Model processes never write the database directly."""

from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import time
import uuid

TERMINAL = {"completed", "partial", "failed", "cancelled", "interrupted"}


class ConflictError(ValueError):
    pass


class JobStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
                audio_sha256 TEXT NOT NULL, language TEXT NOT NULL,
                filename TEXT NOT NULL, extension TEXT NOT NULL,
                status TEXT NOT NULL, stage TEXT NOT NULL, progress REAL NOT NULL,
                error TEXT, result TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL
            )""")
            db.execute("CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at)")

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def public(row):
        if row is None:
            return None
        result = {k: row[k] for k in ("id", "status", "stage", "progress", "error", "audio_sha256", "idempotency_key")}
        result["result"] = json.loads(row["result"]) if row["result"] else None
        return result

    def get(self, job_id: str):
        with self.connection() as db:
            return self.public(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def record(self, job_id: str):
        with self.connection() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            return dict(row) if row else None

    def by_key(self, key):
        with self.connection() as db:
            return self.public(db.execute("SELECT * FROM jobs WHERE idempotency_key=?", (key,)).fetchone())

    def submit(self, *, key, sha256, language, filename, extension, upload: Path, jobs_dir: Path, active_id=None):
        """Commit the row only once its local file is durably in its job directory."""
        now = time.time()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT * FROM jobs WHERE idempotency_key=?", (key,)).fetchone()
            if old:
                if old["audio_sha256"] != sha256 or old["language"] != language:
                    raise ConflictError("idempotency_key_conflict")
                if old["status"] in {"queued", "running", "completed", "partial"}:
                    upload.unlink(missing_ok=True)
                    return self.public(old)
                if old["id"] == active_id:
                    raise ConflictError("job_still_cancelling")
            job_id = old["id"] if old else uuid.uuid4().hex
            directory = jobs_dir / job_id
            directory.mkdir(parents=True, exist_ok=True)
            upload.replace(directory / f"input{extension}")
            for name in ("state.json", "decoded.wav", "worker.log"):
                (directory / name).unlink(missing_ok=True)
            if old:
                db.execute("""UPDATE jobs SET status='queued', stage='queued', progress=0,
                    error=NULL, result=NULL, extension=?, updated_at=? WHERE id=?""",
                    (extension, now, job_id))
            else:
                db.execute("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                    job_id, key, sha256, language, filename, extension,
                    "queued", "queued", 0, None, None, now, now,
                ))
            return self.public(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def queued(self):
        with self.connection() as db:
            row = db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").fetchone()
            return dict(row) if row else None

    def count_queued(self):
        with self.connection() as db:
            return db.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','running')").fetchone()[0]

    def update(self, job_id, *, status, stage, progress, error=None, result=None):
        with self.connection() as db:
            # An already-cancelled job must never be resurrected by a late worker result.
            db.execute("""UPDATE jobs SET status=?,stage=?,progress=?,error=?,
                result=COALESCE(?,result),updated_at=? WHERE id=? AND status IN ('queued','running')""",
                (status, stage, max(0.0, min(1.0, float(progress))), error,
                 json.dumps(result, ensure_ascii=False, allow_nan=False) if result is not None else None,
                 time.time(), job_id))

    def interrupt_running(self):
        with self.connection() as db:
            rows = db.execute("SELECT id FROM jobs WHERE status IN ('running','queued')").fetchall()
            db.execute("""UPDATE jobs SET status='interrupted',stage='interrupted',
                error='server_restarted',updated_at=? WHERE status IN ('running','queued')""", (time.time(),))
            return [row["id"] for row in rows]

    def expired(self, cutoff):
        with self.connection() as db:
            return [row[0] for row in db.execute(
                "SELECT id FROM jobs WHERE updated_at<? AND status NOT IN ('running','queued')", (cutoff,))]

    def delete(self, job_id):
        with self.connection() as db:
            db.execute("DELETE FROM jobs WHERE id=? AND status NOT IN ('running','queued')", (job_id,))
