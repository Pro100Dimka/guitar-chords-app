"""Tenant-scoped SQLite state, durable quotas and conservative audio accounting."""

from contextlib import contextmanager
import hashlib
import hmac
import json
from pathlib import Path
import secrets
import sqlite3
import time
import uuid

TERMINAL = {"completed", "partial", "failed", "cancelled", "interrupted"}
PRIVATE_OWNER = "private"
SCHEMA_VERSION = 2


class ConflictError(ValueError):
    pass


class LimitError(ValueError):
    def __init__(self, detail, retry_after=60, status_code=429):
        super().__init__(detail)
        self.detail, self.retry_after, self.status_code = detail, max(1, int(retry_after)), status_code


class JobStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connection() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version > SCHEMA_VERSION:
                raise RuntimeError("Database schema is newer than this server; restore compatible code")
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("BEGIN IMMEDIATE")
            exists = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'").fetchone()
            if exists:
                columns = {row[1] for row in db.execute("PRAGMA table_info(jobs)")}
                if "owner_id" not in columns:
                    # Transactional table rebuild removes the old global idempotency UNIQUE.
                    db.execute("ALTER TABLE jobs RENAME TO legacy_private_jobs")
                    db.execute("DROP INDEX IF EXISTS jobs_status")
                    self._create_jobs(db)
                    db.execute("""INSERT INTO jobs(id,idempotency_key,owner_id,network_id,audio_sha256,
                        language,filename,extension,status,stage,progress,error,result,created_at,updated_at,
                        completed_at,audio_pending,storage_bytes)
                        SELECT id,idempotency_key,'private','',audio_sha256,language,filename,extension,
                        status,stage,progress,error,result,created_at,updated_at,
                        CASE WHEN status IN ('queued','running') THEN NULL ELSE updated_at END,1,0
                        FROM legacy_private_jobs""")
                    db.execute("DROP TABLE legacy_private_jobs")
                elif version != SCHEMA_VERSION:
                    raise RuntimeError("Unsupported intermediate database schema; migration required")
            else:
                self._create_jobs(db)
            db.execute("CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status,created_at)")
            db.execute("CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(owner_id,status)")
            db.execute("""CREATE TABLE IF NOT EXISTS installations (
                id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
                created_at REAL NOT NULL, expires_at REAL NOT NULL, network_id TEXT NOT NULL)""")
            db.execute("""CREATE TABLE IF NOT EXISTS counters (
                kind TEXT NOT NULL, subject TEXT NOT NULL, window INTEGER NOT NULL,
                count INTEGER NOT NULL, expires_at REAL NOT NULL,
                PRIMARY KEY(kind,subject,window))""")
            db.execute("""CREATE TABLE IF NOT EXISTS uploads (
                id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, storage_bytes INTEGER NOT NULL,
                created_at REAL NOT NULL)""")
            db.execute("""CREATE TABLE IF NOT EXISTS cancellations (
                owner_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,expires_at REAL NOT NULL,
                PRIMARY KEY(owner_id,idempotency_key))""")
            db.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            db.execute("INSERT OR IGNORE INTO metadata VALUES('network_hmac_secret',?)", (secrets.token_hex(32),))
            db.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
        try:
            path.chmod(0o600)
        except OSError:
            pass

    @staticmethod
    def _create_jobs(db):
        db.execute("""CREATE TABLE jobs (
            id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL,owner_id TEXT NOT NULL,
            network_id TEXT NOT NULL,audio_sha256 TEXT NOT NULL,language TEXT NOT NULL,
            filename TEXT NOT NULL,extension TEXT NOT NULL,status TEXT NOT NULL,
            stage TEXT NOT NULL,progress REAL NOT NULL,error TEXT,result TEXT,
            created_at REAL NOT NULL,updated_at REAL NOT NULL,completed_at REAL,
            audio_pending INTEGER NOT NULL DEFAULT 1,storage_bytes INTEGER NOT NULL DEFAULT 0,
            UNIQUE(owner_id,idempotency_key))""")

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def network_id(self, address):
        with self.connection() as db:
            secret = db.execute("SELECT value FROM metadata WHERE key='network_hmac_secret'").fetchone()[0]
        return hmac.new(bytes.fromhex(secret), address.encode("utf-8"), hashlib.sha256).hexdigest()

    @staticmethod
    def _counter(db, kind, subject, period, limit, detail, now):
        window = int(now // period)
        row = db.execute("SELECT count FROM counters WHERE kind=? AND subject=? AND window=?",
                         (kind, subject, window)).fetchone()
        if row and row[0] >= limit:
            raise LimitError(detail, (window + 1) * period - now + 1)
        db.execute("""INSERT INTO counters VALUES(?,?,?,1,?)
            ON CONFLICT(kind,subject,window) DO UPDATE SET count=count+1""",
            (kind, subject, window, (window + 2) * period))

    def request_budget(self, owner, network, settings, *, cancel=False):
        now = time.time()
        kind = "cancel" if cancel else "request"
        limit = settings.cancellations_per_minute if cancel else settings.requests_per_minute
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            self._counter(db, kind + "_network", network, 60, limit, "rate_limit_exceeded", now)
            if owner:
                self._counter(db, kind + "_owner", owner, 60, limit, "rate_limit_exceeded", now)

    def register(self, network, settings):
        now = time.time()
        token = "ft1_" + secrets.token_hex(32)
        identifier = uuid.uuid4().hex
        expires = int(now + settings.installation_ttl_days * 86400)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            self._counter(db, "registration_network", network, 86400,
                          settings.registrations_per_network_day, "registration_rate_limited", now)
            self._counter(db, "registration_global", "global", 3600,
                          settings.registrations_per_hour, "registration_rate_limited", now)
            db.execute("INSERT INTO installations VALUES(?,?,?,?,?)", (
                identifier, hashlib.sha256(token.encode("ascii")).hexdigest(), now, expires, network))
        return {"installationId": identifier, "token": token, "expiresAt": expires}

    def authenticate(self, token):
        if len(token) != 68 or not token.startswith("ft1_"):
            return None
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with self.connection() as db:
            row = db.execute("SELECT id FROM installations WHERE token_hash=? AND expires_at>?",
                             (digest, time.time())).fetchone()
            return row[0] if row else None

    def cancel_request(self, owner, key, retention_hours):
        """A cancellation can precede the upload's commit or its lost HTTP response."""
        now = time.time()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM cancellations WHERE expires_at<=?", (now,))
            existing = db.execute("SELECT 1 FROM cancellations WHERE owner_id=? AND idempotency_key=?",
                                  (owner, key)).fetchone()
            if not existing:
                if db.execute("SELECT count(*) FROM cancellations WHERE owner_id=?", (owner,)).fetchone()[0] >= 128:
                    raise LimitError("cancellation_capacity_exceeded", 60)
                if db.execute("SELECT count(*) FROM cancellations").fetchone()[0] >= 8192:
                    raise LimitError("cancellation_capacity_exceeded", 60)
                db.execute("INSERT INTO cancellations VALUES(?,?,?)", (owner, key, now + retention_hours * 3600))
            row = db.execute("SELECT id FROM jobs WHERE owner_id=? AND idempotency_key=?", (owner, key)).fetchone()
            return row[0] if row else None

    @staticmethod
    def public(row, db=None):
        if row is None:
            return None
        result = {k: row[k] for k in ("id", "status", "stage", "progress", "error", "audio_sha256", "idempotency_key")}
        result["result"] = json.loads(row["result"]) if row["result"] else None
        result["queuePosition"] = 0
        if row["status"] == "queued" and db is not None:
            result["queuePosition"] = db.execute("""SELECT count(*) FROM jobs WHERE status='queued'
                AND (created_at<? OR (created_at=? AND id<=?))""",
                (row["created_at"], row["created_at"], row["id"])).fetchone()[0]
        return result

    def get(self, job_id: str, owner=PRIVATE_OWNER):
        with self.connection() as db:
            sql, args = ("SELECT * FROM jobs WHERE id=?", [job_id])
            if owner is not None:
                sql, args = sql + " AND owner_id=?", args + [owner]
            return self.public(db.execute(sql, args).fetchone(), db)

    def record(self, job_id: str):
        with self.connection() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            return dict(row) if row else None

    def by_key(self, key, owner=PRIVATE_OWNER):
        with self.connection() as db:
            return self.public(db.execute("SELECT * FROM jobs WHERE owner_id=? AND idempotency_key=?",
                                          (owner, key)).fetchone(), db)

    @staticmethod
    def _storage(db, exclude_upload=None):
        jobs = db.execute("SELECT COALESCE(sum(storage_bytes),0) FROM jobs WHERE audio_pending=1").fetchone()[0]
        uploads = db.execute("SELECT COALESCE(sum(storage_bytes),0) FROM uploads WHERE id<>?",
                             (exclude_upload or "",)).fetchone()[0]
        orphan = db.execute("SELECT value FROM metadata WHERE key='orphan_storage_bytes'").fetchone()
        return jobs + uploads + (int(orphan[0]) if orphan else 0)

    def reserve_upload(self, owner, storage_bytes, settings):
        identifier = uuid.uuid4().hex
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT count(*) FROM uploads").fetchone()[0] >= settings.max_concurrent_uploads:
                raise LimitError("upload_capacity_exceeded", 5)
            if settings.service_mode == "shared" and db.execute(
                    "SELECT 1 FROM uploads WHERE owner_id=?", (owner,)).fetchone():
                raise LimitError("installation_upload_in_progress", 5)
            if self._storage(db) + storage_bytes > settings.max_storage_bytes:
                raise LimitError("storage_limit_exceeded", 60, 507)
            db.execute("INSERT INTO uploads VALUES(?,?,?,?)", (identifier, owner, storage_bytes, time.time()))
        return identifier

    def pending_uploads(self):
        with self.connection() as db:
            return [row[0] for row in db.execute("SELECT id FROM uploads")]

    def release_upload(self, identifier):
        with self.connection() as db:
            db.execute("DELETE FROM uploads WHERE id=?", (identifier,))

    def submit(self, *, key, sha256, language, filename, extension, upload: Path, jobs_dir: Path,
               active_id=None, owner=PRIVATE_OWNER, network="", settings=None, upload_id=None):
        """Serialize capacity checks, counters and ownership; publish only durable input files."""
        now = time.time()
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM cancellations WHERE owner_id=? AND idempotency_key=? AND expires_at>?",
                          (owner, key, now)).fetchone():
                raise ConflictError("job_request_cancelled")
            old = db.execute("SELECT * FROM jobs WHERE owner_id=? AND idempotency_key=?", (owner, key)).fetchone()
            if old:
                if old["audio_sha256"] != sha256 or old["language"] != language:
                    raise ConflictError("idempotency_key_conflict")
                if old["status"] in {"queued", "running", "completed", "partial"}:
                    return self.public(old, db)
                if old["id"] == active_id:
                    raise ConflictError("job_still_cancelling")
                if old["audio_pending"]:
                    raise ConflictError("audio_cleanup_pending")
            size = upload.stat().st_size
            storage = size + (settings.decoded_reservation_bytes if settings else 0)
            if settings:
                active = "(status IN ('queued','running') OR audio_pending=1)"
                if db.execute("SELECT count(*) FROM jobs WHERE " + active).fetchone()[0] >= settings.max_queued_jobs:
                    raise LimitError("queue_full", 10)
                if self._storage(db, upload_id) + storage > settings.max_storage_bytes:
                    raise LimitError("storage_limit_exceeded", 60, 507)
                if settings.service_mode == "shared":
                    if db.execute("SELECT count(*) FROM jobs WHERE owner_id=? AND " + active,
                                  (owner,)).fetchone()[0] >= settings.active_jobs_per_installation:
                        raise LimitError("installation_queue_full", 10)
                    self._counter(db, "job_owner", owner, 86400, settings.jobs_per_day,
                                  "installation_daily_limit", now)
                    self._counter(db, "job_network", network, 86400, settings.jobs_per_network_day,
                                  "network_daily_limit", now)
            job_id = old["id"] if old else uuid.uuid4().hex
            directory = jobs_dir / job_id
            directory.mkdir(parents=True, exist_ok=True)
            upload.replace(directory / f"input{extension}")
            try:
                if old:
                    db.execute("""UPDATE jobs SET status='queued',stage='queued',progress=0,
                        error=NULL,result=NULL,extension=?,updated_at=?,created_at=?,completed_at=NULL,
                        audio_pending=1,storage_bytes=?,network_id=? WHERE id=?""",
                        (extension, now, now, storage, network, job_id))
                else:
                    db.execute("""INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                        job_id, key, owner, network, sha256, language,
                        filename if owner == PRIVATE_OWNER else "", extension,
                        "queued", "queued", 0, None, None, now, now, None, 1, storage))
                return self.public(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone(), db)
            except Exception:
                # Keep a cleanup record if SQLite or the disk fails; startup also finds orphan dirs.
                raise

    def queued(self):
        with self.connection() as db:
            row = db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1").fetchone()
            return dict(row) if row else None

    def count_queued(self):
        with self.connection() as db:
            return db.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','running')").fetchone()[0]

    def update(self, job_id, *, status, stage, progress, error=None, result=None):
        now = time.time()
        with self.connection() as db:
            db.execute("""UPDATE jobs SET status=?,stage=?,progress=?,error=?,result=COALESCE(?,result),
                updated_at=?,completed_at=CASE WHEN ? THEN COALESCE(completed_at,?) ELSE completed_at END
                WHERE id=? AND status IN ('queued','running')""",
                (status, stage, max(0.0, min(1.0, float(progress))), error,
                 json.dumps(result, ensure_ascii=False, allow_nan=False) if result is not None else None,
                 now, status in TERMINAL, now, job_id))

    def interrupt_running(self):
        now = time.time()
        with self.connection() as db:
            rows = db.execute("SELECT id FROM jobs WHERE status IN ('running','queued')").fetchall()
            db.execute("""UPDATE jobs SET status='interrupted',stage='interrupted',
                error='server_restarted',updated_at=?,completed_at=? WHERE status IN ('running','queued')""", (now, now))
            return [row["id"] for row in rows]

    def pending_cleanup(self):
        with self.connection() as db:
            return [row[0] for row in db.execute("SELECT id FROM jobs WHERE audio_pending=1 AND status NOT IN ('running','queued')")]

    def cleaned(self, job_id):
        with self.connection() as db:
            db.execute("UPDATE jobs SET audio_pending=0,storage_bytes=0 WHERE id=? AND status NOT IN ('running','queued')",
                       (job_id,))

    def cleanup_failed(self, job_id, reservation):
        with self.connection() as db:
            db.execute("UPDATE jobs SET audio_pending=1,storage_bytes=max(storage_bytes,?) WHERE id=?",
                       (reservation, job_id))

    def account_orphans(self, value):
        with self.connection() as db:
            db.execute("INSERT INTO metadata VALUES('orphan_storage_bytes',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                       (str(value),))

    def expired(self, cutoff):
        with self.connection() as db:
            return [row[0] for row in db.execute("""SELECT id FROM jobs WHERE completed_at<?
                AND status NOT IN ('running','queued')""", (cutoff,))]

    def delete(self, job_id):
        with self.connection() as db:
            db.execute("DELETE FROM jobs WHERE id=? AND audio_pending=0 AND status NOT IN ('running','queued')", (job_id,))

    def maintain_metadata(self):
        with self.connection() as db:
            db.execute("DELETE FROM counters WHERE expires_at<?", (time.time(),))
            db.execute("DELETE FROM cancellations WHERE expires_at<=?", (time.time(),))
            db.execute("""DELETE FROM installations WHERE expires_at<?
                AND NOT EXISTS(SELECT 1 FROM jobs WHERE jobs.owner_id=installations.id)
                AND NOT EXISTS(SELECT 1 FROM uploads WHERE uploads.owner_id=installations.id)""", (time.time(),))
