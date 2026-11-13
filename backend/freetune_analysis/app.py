"""HTTP API for private developer servers and a developer-operated shared service."""

import asyncio
from contextlib import asynccontextmanager
import hashlib
import hmac
import ipaddress
import os
from pathlib import Path
import re
import shutil
import sqlite3
import time

from fastapi import FastAPI, HTTPException, Request
from filelock import FileLock, Timeout
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser
from starlette.requests import ClientDisconnect
from starlette.responses import JSONResponse
from python_multipart.exceptions import MultipartParseError

from .config import Settings
from .pipeline import availability
from .store import JobStore, ConflictError, LimitError, PRIVATE_OWNER
from .supervisor import Supervisor


def limit_response(exc):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code,
                        headers={"Retry-After": str(exc.retry_after), "Cache-Control": "no-store"})


class BoundedMultipartParser(MultiPartParser):
    """Field-body limits do not include multipart headers such as filenames."""

    def on_part_begin(self):
        self.header_bytes = 0
        super().on_part_begin()

    def _header_size(self, start, end):
        self.header_bytes += end - start
        if self.header_bytes > 16 * 1024:
            raise MultiPartException("Multipart headers too large")

    def on_header_field(self, data, start, end):
        self._header_size(start, end)
        super().on_header_field(data, start, end)

    def on_header_value(self, data, start, end):
        self._header_size(start, end)
        super().on_header_value(data, start, end)


class RequestLimits:
    """Authenticate, reserve capacity and limit the stream before multipart parsing."""

    def __init__(self, app, settings, store, supervisor):
        self.app, self.settings, self.store, self.supervisor = app, settings, store, supervisor
        self.inflight = 0
        self.cancelling = 0

    def network(self, scope, headers):
        address = (scope.get("client") or ("unknown", 0))[0]
        try:
            address = str(ipaddress.ip_address(address))
        except ValueError:
            address = "unknown"
        trusted = {str(ipaddress.ip_address(value)) for value in self.settings.trusted_proxy_ips}
        if address in trusted:
            # Caddy replaces this header with its socket peer. Never consult X-Forwarded-For.
            forwarded = headers.get(b"x-freetune-client-ip", b"").decode("ascii", errors="ignore")
            try:
                address = str(ipaddress.ip_address(forwarded))
            except ValueError:
                pass
        return self.store.network_id(address)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        path, method = scope["path"], scope["method"]
        is_cancel = method == "DELETE" and path.startswith(("/v1/jobs/", "/v1/job-requests/"))
        is_upload = method == "POST" and path == "/v1/jobs"
        is_registration = method == "POST" and path == "/v1/installations"
        network = self.network(scope, headers)
        state = scope.setdefault("state", {})
        state["network_id"] = network
        shared = self.settings.service_mode == "shared"
        owner = None if shared else PRIVATE_OWNER
        authorization = headers.get(b"authorization", b"")
        if path.startswith("/v1/") and not is_registration:
            if shared:
                try:
                    token = authorization.removeprefix(b"Bearer ").decode("ascii")
                except UnicodeDecodeError:
                    token = ""
                owner = self.store.authenticate(token) if authorization.startswith(b"Bearer ") else None
            elif self.settings.token:
                expected = ("Bearer " + self.settings.token).encode()
                owner = PRIVATE_OWNER if hmac.compare_digest(authorization, expected) else None
        try:
            if shared:
                self.store.request_budget(owner, network, self.settings, cancel=is_cancel)
            if path.startswith("/v1/") and not is_registration and owner is None:
                return await JSONResponse({"detail": "unauthorized"}, 401,
                                          headers={"Cache-Control": "no-store"})(scope, receive, send)
            if is_cancel:
                if self.cancelling >= 4:
                    raise LimitError("request_capacity_exceeded", 2)
            elif self.inflight >= self.settings.max_http_requests:
                raise LimitError("request_capacity_exceeded", 2)
            body_limit = self.settings.max_upload_bytes + 1024 * 1024 if is_upload else 4096
            lengths = [value for name, value in scope["headers"] if name == b"content-length"]
            if len(lengths) > 1:
                return await JSONResponse({"detail": "invalid_content_length"}, 400)(scope, receive, send)
            try:
                length = int(headers.get(b"content-length", b"0"))
                if length < 0:
                    raise ValueError
            except ValueError:
                return await JSONResponse({"detail": "invalid_content_length"}, 400)(scope, receive, send)
            if length > body_limit:
                return await JSONResponse({"detail": "audio_too_large"}, 413)(scope, receive, send)
            state["owner_id"] = owner
            upload_id = None
            if is_upload:
                # During multipart copying, a spool and durable source can coexist.
                streamed = body_limit if b"transfer-encoding" in headers else length or body_limit
                reservation = 2 * streamed + self.settings.decoded_reservation_bytes
                upload_id = self.store.reserve_upload(owner, reservation, self.settings)
                self.supervisor.active_uploads.add(upload_id)
                state["upload_id"] = upload_id
            if is_cancel:
                self.cancelling += 1
            else:
                self.inflight += 1
        except LimitError as exc:
            return await limit_response(exc)(scope, receive, send)
        received, started, upload_released = 0, time.monotonic(), False

        def release_upload():
            nonlocal upload_released
            if upload_id and not upload_released:
                self.supervisor.active_uploads.discard(upload_id)
                self.supervisor.cleanup_upload(upload_id)
                upload_released = True

        async def bounded_receive():
            nonlocal received
            remaining = self.settings.upload_timeout_seconds - (time.monotonic() - started)
            if remaining <= 0:
                raise HTTPException(408, "upload_timeout")
            try:
                message = await asyncio.wait_for(receive(), remaining)
            except asyncio.TimeoutError:
                raise HTTPException(408, "upload_timeout") from None
            received += len(message.get("body", b""))
            if received > body_limit:
                raise HTTPException(413, "audio_too_large")
            return message

        async def private_send(message):
            if message["type"] == "http.response.start":
                # Parsing/copying has finished. Release staging before acknowledging
                # so an immediate retry cannot race a successful response's lease.
                release_upload()
                message.setdefault("headers", []).append((b"cache-control", b"no-store"))
            await send(message)

        try:
            return await self.app(scope, bounded_receive, private_send)
        finally:
            if is_cancel:
                self.cancelling -= 1
            else:
                self.inflight -= 1
            release_upload()


def create_app(settings: Settings | None = None):
    settings = settings or Settings.from_env()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    # Schema migration must not precede ownership of the service directory: a newer
    # process must never mutate the database beneath an already running old server.
    try:
        with FileLock(str(settings.data_dir / "service.lock")).acquire(timeout=0):
            store = JobStore(settings.data_dir / "jobs.sqlite3")
    except Timeout:
        raise RuntimeError("Another FreeTune server already owns FREETUNE_DATA_DIR") from None
    supervisor = Supervisor(settings, store)
    readiness = None
    readiness_at = 0.0
    readiness_lock = asyncio.Lock()

    async def model_state():
        nonlocal readiness, readiness_at
        # Hashes are expensive; a short cache keeps health polling cheap. Workers recheck.
        if readiness is None or time.monotonic() - readiness_at > 30:
            async with readiness_lock:
                if readiness is None or time.monotonic() - readiness_at > 30:
                    readiness = await asyncio.to_thread(availability, settings)
                    readiness_at = time.monotonic()
        return readiness

    @asynccontextmanager
    async def lifespan(app):
        await supervisor.start()
        try:
            yield
        finally:
            await supervisor.stop()

    app = FastAPI(title="FreeTune Audio Analysis", version="1.1.0", lifespan=lifespan,
                  docs_url=None if settings.service_mode == "shared" else "/docs",
                  redoc_url=None, openapi_url=None if settings.service_mode == "shared" else "/openapi.json")
    app.add_middleware(RequestLimits, settings=settings, store=store, supervisor=supervisor)
    app.state.store, app.state.supervisor = store, supervisor

    @app.exception_handler(LimitError)
    async def limited(request, exc):
        return limit_response(exc)

    @app.get("/health")
    async def health():
        state = await model_state()
        authentication = "installation" if settings.service_mode == "shared" else "bearer" if settings.token else "none"
        return {"status": "ok", "version": 1, **state,
                "serviceMode": settings.service_mode, "authentication": authentication,
                "authenticationRequired": authentication != "none",
                "limits": {"uploadBytes": settings.max_upload_bytes,
                           "durationSeconds": settings.max_duration_seconds,
                           "activeJobsPerInstallation": settings.active_jobs_per_installation,
                           "jobsPerDay": settings.jobs_per_day},
                "privacy": {"audioDeletion": "after_processing",
                            "resultRetentionHours": settings.retention_hours,
                            "installationTtlDays": settings.installation_ttl_days}}

    @app.post("/v1/installations", status_code=201)
    async def register(request: Request):
        if settings.service_mode != "shared":
            raise HTTPException(404, "shared_registration_disabled")
        return store.register(request.state.network_id, settings)

    @app.post("/v1/jobs", status_code=202)
    async def submit(request: Request):
        if settings.service_mode == "shared" and not (await model_state())["ready"]:
            raise HTTPException(503, "service_not_ready", headers={"Retry-After": "60"})
        if not request.headers.get("content-type", "").lower().startswith("multipart/form-data"):
            raise HTTPException(422, "multipart_required")
        parser = BoundedMultipartParser(request.headers, request.stream(), max_files=1, max_fields=3, max_part_size=1024)
        try:
            form = await parser.parse()
            if len(form.multi_items()) != len(form) or not {"file", "idempotency_key", "audio_sha256"} <= set(form.keys()) or not set(form.keys()) <= {"file", "language", "idempotency_key", "audio_sha256"}:
                raise HTTPException(422, "invalid_upload_fields")
            file, language = form["file"], form.get("language", "auto")
            key, sha256 = form["idempotency_key"], form["audio_sha256"]
            if not isinstance(file, UploadFile) or not all(isinstance(x, str) for x in (language, key, sha256)):
                raise HTTPException(422, "invalid_upload_fields")
            if language not in {"auto", "uk", "ru", "en"}:
                raise HTTPException(422, "unsupported_language")
            if not re.fullmatch(r"[A-Za-z0-9_.:\-]{1,128}", key):
                raise HTTPException(422, "invalid_idempotency_key")
            if not re.fullmatch(r"[a-fA-F0-9]{64}", sha256):
                raise HTTPException(422, "invalid_audio_sha256")
            extension = Path(file.filename or "").suffix.lower()
            if extension not in {".mp3", ".wav", ".m4a"}:
                raise HTTPException(415, "unsupported_format")
            directory = settings.jobs_dir / "uploads" / request.state.upload_id
            directory.mkdir(parents=True, exist_ok=True)
            upload = directory / "source.part"
            digest, size = hashlib.sha256(), 0
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
            if not hmac.compare_digest(digest.hexdigest(), sha256.lower()):
                raise HTTPException(422, "audio_hash_mismatch")
            async with supervisor.lock:
                return store.submit(key=key, sha256=sha256.lower(), language=language,
                                    filename=Path(file.filename or "audio").name[:200], extension=extension,
                                    upload=upload, jobs_dir=settings.jobs_dir, active_id=supervisor.active_id,
                                    owner=request.state.owner_id, network=request.state.network_id,
                                    settings=settings, upload_id=request.state.upload_id)
        except ConflictError as exc:
            raise HTTPException(409, str(exc)) from None
        except (MultiPartException, MultipartParseError):
            raise HTTPException(422, "invalid_multipart") from None
        except ClientDisconnect:
            raise HTTPException(400, "upload_disconnected") from None
        except sqlite3.Error:
            raise HTTPException(500, "storage_failed") from None
        except OSError as exc:
            raise HTTPException(507 if exc.errno == 28 else 500,
                                "insufficient_disk_space" if exc.errno == 28 else "storage_failed") from None
        finally:
            # Close every spool even when receive() times out, a client disconnects or parsing fails.
            for temporary in parser._files_to_close_on_error:
                temporary.close()

    @app.get("/v1/jobs/{job_id}")
    async def get_job(job_id: str, request: Request):
        result = store.get(job_id, request.state.owner_id)
        if result is None:
            raise HTTPException(404, "job_not_found")
        return result

    @app.delete("/v1/job-requests/{key}")
    async def cancel_request(key: str, request: Request):
        if not re.fullmatch(r"[A-Za-z0-9_.:\-]{1,128}", key):
            raise HTTPException(422, "invalid_idempotency_key")
        job_id = store.cancel_request(request.state.owner_id, key, settings.retention_hours)
        result = await supervisor.cancel(job_id, request.state.owner_id) if job_id else None
        return {"cancellationRecorded": True, "idempotency_key": key,
                "jobId": job_id, "jobStatus": result["status"] if result else None}

    @app.delete("/v1/jobs/{job_id}")
    async def delete_job(job_id: str, request: Request):
        if not re.fullmatch(r"[a-f0-9]{32}", job_id):
            raise HTTPException(404, "job_not_found")
        result = await supervisor.cancel(job_id, request.state.owner_id)
        if result is None:
            raise HTTPException(404, "job_not_found")
        return result

    return app


app = create_app()
