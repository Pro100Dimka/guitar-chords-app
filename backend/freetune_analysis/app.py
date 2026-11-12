import asyncio
from contextlib import asynccontextmanager
import hashlib
import hmac
import os
from pathlib import Path
import re
import shutil
import uuid

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.responses import JSONResponse

from .config import Settings
from .pipeline import availability
from .store import JobStore, ConflictError
from .supervisor import Supervisor


class RequestLimits:
    """Authenticate and bound body bytes before Starlette parses multipart data."""

    def __init__(self, app, settings):
        self.app, self.settings = app, settings

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/v1/"):
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        expected = ("Bearer " + self.settings.token).encode()
        if self.settings.token and not hmac.compare_digest(headers.get(b"authorization", b""), expected):
            return await JSONResponse({"detail": "unauthorized"}, status_code=401)(scope, receive, send)
        limit = self.settings.max_upload_bytes + 1024 * 1024
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            return await JSONResponse({"detail": "invalid_content_length"}, status_code=400)(scope, receive, send)
        if length > limit:
            return await JSONResponse({"detail": "audio_too_large"}, status_code=413)(scope, receive, send)
        received = 0

        async def bounded_receive():
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > limit:
                raise HTTPException(413, "audio_too_large")
            return message

        return await self.app(scope, bounded_receive, send)


def create_app(settings: Settings | None = None):
    settings = settings or Settings.from_env()
    store = JobStore(settings.data_dir / "jobs.sqlite3")
    supervisor = Supervisor(settings, store)

    @asynccontextmanager
    async def lifespan(app):
        await supervisor.start()
        yield
        await supervisor.stop()

    app = FastAPI(title="FreeTune Audio Analysis", version="1.0.0", lifespan=lifespan)
    app.add_middleware(RequestLimits, settings=settings)
    app.state.store, app.state.supervisor = store, supervisor

    @app.get("/health")
    async def health():
        state = await asyncio.to_thread(availability, settings)
        return {"status": "ok", "version": 1, **state,
                "limits": {"uploadBytes": settings.max_upload_bytes,
                           "durationSeconds": settings.max_duration_seconds},
                "authenticationRequired": bool(settings.token)}

    @app.post("/v1/jobs", status_code=202)
    async def submit(file: UploadFile = File(...), language: str = Form("auto"),
                     idempotency_key: str = Form(...), audio_sha256: str = Form(...)):
        if language not in {"auto", "uk", "ru", "en"}:
            raise HTTPException(422, "unsupported_language")
        if not re.fullmatch(r"[A-Za-z0-9_.:\-]{1,128}", idempotency_key):
            raise HTTPException(422, "invalid_idempotency_key")
        if not re.fullmatch(r"[a-fA-F0-9]{64}", audio_sha256):
            raise HTTPException(422, "invalid_audio_sha256")
        extension = Path(file.filename or "").suffix.lower()
        if extension not in {".mp3", ".wav", ".m4a"}:
            raise HTTPException(415, "unsupported_format")
        settings.jobs_dir.mkdir(parents=True, exist_ok=True)
        upload = settings.jobs_dir / f"upload-{uuid.uuid4().hex}.part"
        digest, size = hashlib.sha256(), 0
        try:
            with upload.open("wb") as output:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > settings.max_upload_bytes:
                        raise HTTPException(413, "audio_too_large")
                    if shutil.disk_usage(settings.jobs_dir).free < len(chunk) + 32 * 1024 * 1024:
                        raise HTTPException(507, "insufficient_disk_space")
                    digest.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if size == 0:
                raise HTTPException(422, "empty_audio")
            if not hmac.compare_digest(digest.hexdigest(), audio_sha256.lower()):
                raise HTTPException(422, "audio_hash_mismatch")
            async with supervisor.lock:
                existing = store.by_key(idempotency_key)
                needs_slot = not existing or existing["status"] in {"failed", "cancelled", "interrupted"}
                if needs_slot and store.count_queued() >= settings.max_queued_jobs:
                    raise HTTPException(429, "queue_full")
                return store.submit(key=idempotency_key, sha256=audio_sha256.lower(), language=language,
                                    filename=Path(file.filename or "audio").name[:200], extension=extension,
                                    upload=upload, jobs_dir=settings.jobs_dir, active_id=supervisor.active_id)
        except ConflictError as exc:
            raise HTTPException(409, str(exc)) from None
        except OSError as exc:
            raise HTTPException(507 if exc.errno == 28 else 500,
                                "insufficient_disk_space" if exc.errno == 28 else "storage_failed") from None
        finally:
            upload.unlink(missing_ok=True)
            await file.close()

    @app.get("/v1/jobs/{job_id}")
    async def get_job(job_id: str):
        result = store.get(job_id)
        if result is None:
            raise HTTPException(404, "job_not_found")
        return result

    @app.delete("/v1/jobs/{job_id}")
    async def delete_job(job_id: str):
        # Resolve through SQLite first; user-supplied IDs never become unchecked paths.
        if not re.fullmatch(r"[a-f0-9]{32}", job_id):
            raise HTTPException(404, "job_not_found")
        result = await supervisor.cancel(job_id)
        if result is None:
            raise HTTPException(404, "job_not_found")
        return result

    return app


app = create_app()
