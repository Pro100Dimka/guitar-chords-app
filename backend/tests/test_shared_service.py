"""Shared HTTP/TCP/SQLite and privacy contracts; inference is parked here.

shared_smoke.py separately exercises real installed models. No phone or model
accuracy evidence is implied by these API tests.
"""
import asyncio
from contextlib import contextmanager
from dataclasses import replace
import hashlib
import http.client
import json
from pathlib import Path
import socket
import sqlite3
import threading
import time

from fastapi.testclient import TestClient
from filelock import FileLock
import httpx
import pytest
import uvicorn

import freetune_analysis.app as api
from freetune_analysis.config import Settings
from freetune_analysis.store import JobStore, SCHEMA_VERSION
from freetune_analysis.supervisor import Supervisor


async def idle(self):
    await asyncio.Event().wait()


READY = {"ready": True, "models": {"lyrics": {"name": "contract-only", "ready": True},
                                   "chords": {"name": "contract-only", "ready": True},
                                   "decoder": {"name": "ffmpeg", "ready": True}}}
AUDIO = b"bounded contract upload; not model audio"


@pytest.fixture
def settings(tmp_path):
    return Settings(data_dir=tmp_path, service_mode="shared", max_duration_seconds=60)


@pytest.fixture(autouse=True)
def park_inference(monkeypatch):
    monkeypatch.setattr(Supervisor, "run", idle)
    monkeypatch.setattr(api, "availability", lambda settings: READY)


@pytest.fixture
def app(settings):
    return api.create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app) as client:
        yield client


def register(client, **kwargs):
    response = client.post("/v1/installations", **kwargs)
    assert response.status_code == 201, response.text
    return response.json()


def headers(installation):
    return {"Authorization": "Bearer " + installation["token"]}


def submit(client, installation, key="same-key", audio=AUDIO):
    return client.post("/v1/jobs", headers=headers(installation),
                       files={"file": ("private-original-name.wav", audio, "audio/wav")},
                       data={"idempotency_key": key, "language": "en",
                             "audio_sha256": hashlib.sha256(audio).hexdigest()})


def test_token_hash_only_health_and_filename_privacy(client):
    health = client.get("/health").json()
    assert health["serviceMode"] == "shared" and health["authentication"] == "installation"
    assert health["ready"] and health["limits"]["activeJobsPerInstallation"] == 2
    assert health["privacy"] == {"audioDeletion": "after_processing", "resultRetentionHours": 24,
                                 "installationTtlDays": 90}
    installation = register(client)
    assert len(installation["token"]) == 68 and installation["token"].startswith("ft1_")
    assert 89.99 * 86400 < installation["expiresAt"] - time.time() <= 90 * 86400
    job = submit(client, installation).json()
    with client.app.state.store.connection() as db:
        saved = dict(db.execute("SELECT * FROM installations").fetchone())
        assert saved["token_hash"] == hashlib.sha256(installation["token"].encode()).hexdigest()
        assert installation["token"] not in json.dumps(saved)
        row = dict(db.execute("SELECT * FROM jobs").fetchone())
        assert row["filename"] == "" and row["owner_id"] == installation["installationId"]
        assert "testclient" not in row["network_id"]
    assert job["queuePosition"] == 1


def test_tenant_get_delete_and_keys_are_isolated(client):
    a, b = register(client), register(client)
    first, other = submit(client, a), submit(client, b)
    assert first.status_code == other.status_code == 202
    assert first.json()["id"] != other.json()["id"] and other.json()["queuePosition"] == 2
    path = "/v1/jobs/" + first.json()["id"]
    assert client.get(path, headers=headers(b)).status_code == 404
    assert client.delete(path, headers=headers(b)).status_code == 404
    assert client.get(path, headers=headers(a)).json()["status"] == "queued"
    assert submit(client, a).json()["id"] == first.json()["id"]
    assert submit(client, a, audio=AUDIO + b" changed").status_code == 409


def test_auth_precedes_parsing_and_expiry_is_enforced(client):
    assert client.post("/v1/jobs", content=b"garbage").status_code == 401
    installation = register(client)
    with client.app.state.store.connection() as db:
        db.execute("UPDATE installations SET expires_at=0")
    assert submit(client, installation).status_code == 401


def test_daily_quota_persists_and_idempotency_does_not_charge(settings):
    settings = replace(settings, active_jobs_per_installation=1, jobs_per_day=2)
    with TestClient(api.create_app(settings)) as client:
        installation = register(client)
        first = submit(client, installation)
        assert first.status_code == 202
        assert submit(client, installation).json()["id"] == first.json()["id"]
        assert submit(client, installation, "second").json()["detail"] == "installation_queue_full"
        client.delete("/v1/jobs/" + first.json()["id"], headers=headers(installation))
        second = submit(client, installation, "second")
        assert second.status_code == 202
        client.delete("/v1/jobs/" + second.json()["id"], headers=headers(installation))
    with TestClient(api.create_app(settings)) as restarted:
        denied = submit(restarted, installation, "third")
        assert denied.status_code == 429 and denied.json()["detail"] == "installation_daily_limit"
        assert int(denied.headers["Retry-After"]) > 0


def test_network_quota_ignores_untrusted_forwarded_headers(settings):
    settings = replace(settings, jobs_per_network_day=1)
    with TestClient(api.create_app(settings), client=("203.0.113.4", 4000)) as client:
        a, b = register(client), register(client)
        assert submit(client, a).status_code == 202
        client.headers.update({"X-Forwarded-For": "198.51.100.40", "Forwarded": "for=198.51.100.40",
                               "X-FreeTune-Client-IP": "198.51.100.40"})
        denied = submit(client, b)
        assert denied.status_code == 429 and denied.json()["detail"] == "network_daily_limit"


def test_exact_proxy_header_only(settings):
    settings = replace(settings, trusted_proxy_ips=("127.0.0.1",), registrations_per_network_day=1)
    with TestClient(api.create_app(settings), client=("127.0.0.1", 5000)) as client:
        assert client.post("/v1/installations", headers={"X-FreeTune-Client-IP": "203.0.113.1"}).status_code == 201
        assert client.post("/v1/installations", headers={"X-FreeTune-Client-IP": "203.0.113.2"}).status_code == 201
        assert client.post("/v1/installations", headers={"X-FreeTune-Client-IP": "203.0.113.1"}).status_code == 429
    with pytest.raises(ValueError):
        replace(settings, trusted_proxy_ips=("127.0.0.0/8",))


def test_registration_caps_are_persistent(settings):
    settings = replace(settings, registrations_per_network_day=1, registrations_per_hour=2)
    with TestClient(api.create_app(settings), client=("203.0.113.1", 5000)) as first:
        register(first)
        assert first.post("/v1/installations").status_code == 429
    with TestClient(api.create_app(settings), client=("203.0.113.2", 5000)) as second:
        register(second)
    with TestClient(api.create_app(settings), client=("203.0.113.3", 5000)) as third:
        denied = third.post("/v1/installations")
        assert denied.status_code == 429 and int(denied.headers["Retry-After"]) > 0


def test_poll_exhaustion_cannot_block_cancellation(settings):
    settings = replace(settings, requests_per_minute=5, cancellations_per_minute=2)
    with TestClient(api.create_app(settings)) as client:
        installation = register(client)
        job = submit(client, installation).json()
        path = "/v1/jobs/" + job["id"]
        for _ in range(6):
            exhausted = client.get(path, headers=headers(installation))
        assert exhausted.status_code == 429
        cancelled = client.delete(path, headers=headers(installation))
        assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
        assert not (settings.jobs_dir / job["id"]).exists()


def test_multipart_fields_and_text_size_are_bounded(client):
    installation = register(client)
    response = client.post("/v1/jobs", headers=headers(installation),
                           files={"file": ("file.wav", AUDIO)}, data={"extra" + str(i): "x" for i in range(20)})
    assert response.status_code == 422
    response = client.post("/v1/jobs", headers=headers(installation),
                           files={"file": ("file.wav", AUDIO)}, data={"language": "x" * 2048})
    assert response.status_code == 422
    assert client.app.state.store.pending_uploads() == []


def test_completed_delete_keeps_result_and_does_not_extend_retention(client):
    installation = register(client)
    job = submit(client, installation).json()
    store = client.app.state.store
    store.update(job["id"], status="completed", stage="done", progress=1, result={"saved": True})
    before = store.record(job["id"])["completed_at"]
    path = "/v1/jobs/" + job["id"]
    assert client.delete(path, headers=headers(installation)).json()["result"] == {"saved": True}
    assert store.record(job["id"])["completed_at"] == before
    assert client.get(path, headers=headers(installation)).json()["result"] == {"saved": True}
    with store.connection() as db:
        db.execute("UPDATE jobs SET completed_at=? WHERE id=?", (time.time() - 86401, job["id"]))
    client.app.state.supervisor.maintain()
    assert client.get(path, headers=headers(installation)).status_code == 404


def test_failed_deletion_keeps_reservation_row_and_retries(settings, monkeypatch):
    settings = replace(settings, active_jobs_per_installation=1)
    app = api.create_app(settings)
    with TestClient(app) as client:
        installation = register(client)
        job = submit(client, installation).json()
        directory = settings.jobs_dir / job["id"]
        real_delete = api.shutil.rmtree
        def fail_target(path, *args, **kwargs):
            if Path(path) == directory:
                raise PermissionError("simulated filesystem denial")
            return real_delete(path, *args, **kwargs)
        monkeypatch.setattr(api.shutil, "rmtree", fail_target)
        assert client.delete("/v1/jobs/" + job["id"], headers=headers(installation)).json()["status"] == "cancelled"
        saved = app.state.store.record(job["id"])
        assert saved["audio_pending"] == 1 and saved["storage_bytes"] > len(AUDIO)
        assert submit(client, installation).json()["detail"] == "audio_cleanup_pending"
        assert submit(client, installation, "new").json()["detail"] == "installation_queue_full"
        with app.state.store.connection() as db:
            db.execute("UPDATE jobs SET completed_at=0")
        app.state.supervisor.maintain()
        assert app.state.store.record(job["id"]) is not None and directory.exists()
        monkeypatch.setattr(api.shutil, "rmtree", real_delete)
        app.state.supervisor.maintain()
        assert app.state.store.record(job["id"]) is None and not directory.exists()


def test_busy_worker_does_not_delay_retention(settings, monkeypatch):
    async def busy(self):
        self.active_id = "b" * 32
        await asyncio.Event().wait()
    monkeypatch.setattr(Supervisor, "run", busy)
    app = api.create_app(settings)
    with TestClient(app) as client:
        installation = register(client)
        job = submit(client, installation).json()
        app.state.store.update(job["id"], status="completed", stage="done", progress=1, result={"expired": True})
        with app.state.store.connection() as db:
            db.execute("UPDATE jobs SET completed_at=0")
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline and app.state.store.record(job["id"]):
            time.sleep(0.05)
        assert app.state.store.record(job["id"]) is None
        assert not (settings.jobs_dir / job["id"]).exists()


def test_legacy_database_migrates_private_and_future_schema_refused(tmp_path):
    path = tmp_path / "jobs.sqlite3"
    with sqlite3.connect(path) as db:
        db.execute("""CREATE TABLE jobs(id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,
            audio_sha256 TEXT NOT NULL,language TEXT NOT NULL,filename TEXT NOT NULL,extension TEXT NOT NULL,
            status TEXT NOT NULL,stage TEXT NOT NULL,progress REAL NOT NULL,error TEXT,result TEXT,
            created_at REAL NOT NULL,updated_at REAL NOT NULL)""")
        db.execute("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   ("a" * 32, "old", "b" * 64, "en", "original.wav", ".wav", "completed", "done", 1,
                    None, '{"private":"preserved"}', time.time(), time.time()))
    store = JobStore(path)
    assert store.get("a" * 32)["result"] == {"private": "preserved"}
    assert store.get("a" * 32, owner="other") is None
    with store.connection() as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        db.execute(f"PRAGMA user_version={SCHEMA_VERSION + 1}")
    with pytest.raises(RuntimeError, match="newer"):
        JobStore(path)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT result FROM jobs").fetchone()[0] == '{"private":"preserved"}'
        assert db.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION + 1


def test_process_lock_preserves_first_server(app):
    with TestClient(app):
        with pytest.raises(RuntimeError, match="already owns"):
            api.create_app(app.state.supervisor.settings)
        assert not app.state.supervisor.task.done()


@contextmanager
def tcp_server(app):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    config = uvicorn.Config(app, host="127.0.0.1", port=port, access_log=False,
                            log_level="error", proxy_headers=False)
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 5
    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert server.started
    try:
        yield "http://127.0.0.1:" + str(port), port
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        sock.close()
        assert not thread.is_alive()


def test_real_tcp_two_tenants_retry_cancel_cleanup(app):
    with tcp_server(app) as (base, _), httpx.Client(base_url=base, timeout=5, trust_env=False) as client:
        assert client.get("/health").json()["ready"]
        a, b = register(client), register(client)
        first = submit(client, a).json()
        assert submit(client, a).json()["id"] == first["id"]
        assert client.get("/v1/jobs/" + first["id"], headers=headers(b)).status_code == 404
        assert client.delete("/v1/jobs/" + first["id"], headers=headers(a)).json()["status"] == "cancelled"
        assert not (app.state.supervisor.settings.jobs_dir / first["id"]).exists()
        assert submit(client, a).json()["id"] == first["id"]


def test_real_tcp_admission_timeout_and_cancel_reserved_path(settings):
    settings = replace(settings, max_http_requests=1, max_concurrent_uploads=1, upload_timeout_seconds=2)
    app = api.create_app(settings)
    with tcp_server(app) as (base, port), httpx.Client(base_url=base, timeout=4, trust_env=False) as client:
        installation = register(client)
        job = submit(client, installation).json()
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=4)
        connection.putrequest("POST", "/v1/jobs")
        connection.putheader("Authorization", headers(installation)["Authorization"])
        connection.putheader("Content-Type", "multipart/form-data; boundary=slow")
        connection.putheader("Content-Length", "1000")
        connection.endheaders()
        try:
            deadline = time.monotonic() + 1
            while not app.state.supervisor.active_uploads and time.monotonic() < deadline:
                time.sleep(0.01)
            assert app.state.supervisor.active_uploads
            assert submit(client, installation, "another").status_code == 429
            assert client.delete("/v1/jobs/" + job["id"], headers=headers(installation)).json()["status"] == "cancelled"
            assert connection.getresponse().status == 408
        finally:
            connection.close()
        deadline = time.monotonic() + 1
        while app.state.store.pending_uploads() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert app.state.store.pending_uploads() == []


def test_real_tcp_declared_and_streamed_body_size_are_bounded(settings):
    settings = replace(settings, max_upload_bytes=1024)
    app = api.create_app(settings)
    with tcp_server(app) as (base, port), httpx.Client(base_url=base, timeout=4, trust_env=False) as client:
        installation = register(client)
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=4)
        connection.putrequest("POST", "/v1/jobs")
        connection.putheader("Authorization", headers(installation)["Authorization"])
        connection.putheader("Content-Length", str(2 * 1024**2))
        connection.endheaders()
        assert connection.getresponse().status == 413
        connection.close()
        body = [b"--large\r\nContent-Disposition: form-data; name=\"file\"; filename=\"x.wav\"\r\n\r\n",
                b"x" * (1024**2 + 2048), b"\r\n--large--\r\n"]
        response = client.post("/v1/jobs", headers={**headers(installation),
                               "Content-Type": "multipart/form-data; boundary=large"}, content=iter(body))
        assert response.status_code == 413 and app.state.store.pending_uploads() == []


def test_storage_reservation_rejects_before_body(settings):
    settings = replace(settings, max_storage_bytes=100)
    with TestClient(api.create_app(settings)) as client:
        installation = register(client)
        response = submit(client, installation)
        assert response.status_code == 507 and response.json()["detail"] == "storage_limit_exceeded"


def test_held_service_lock_prevents_schema_migration(settings):
    path = settings.data_dir / "jobs.sqlite3"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE jobs(id TEXT PRIMARY KEY, original TEXT)")
        db.execute("INSERT INTO jobs VALUES('legacy','do not change')")
    with FileLock(str(settings.data_dir / "service.lock")):
        with pytest.raises(RuntimeError, match="already owns"):
            api.create_app(settings)
    with sqlite3.connect(path) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 0
        assert db.execute("SELECT * FROM jobs").fetchall() == [("legacy", "do not change")]
        assert {row[1] for row in db.execute("PRAGMA table_info(jobs)")} == {"id", "original"}


def test_failed_migration_rolls_back_table_rename(tmp_path):
    path = tmp_path / "invalid-legacy.sqlite3"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE jobs(id TEXT PRIMARY KEY,idempotency_key TEXT UNIQUE)")
        db.execute("INSERT INTO jobs VALUES('legacy','preserve')")
    with pytest.raises(sqlite3.OperationalError):
        JobStore(path)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT * FROM jobs").fetchall() == [("legacy", "preserve")]
        assert db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == [("jobs",)]
        assert db.execute("PRAGMA user_version").fetchone()[0] == 0


def test_real_tcp_one_upload_per_installation_before_body(settings):
    settings = replace(settings, upload_timeout_seconds=2)
    app = api.create_app(settings)
    with tcp_server(app) as (base, port), httpx.Client(base_url=base, timeout=4, trust_env=False) as client:
        first, second = register(client), register(client)
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=4)
        connection.putrequest("POST", "/v1/jobs")
        connection.putheader("Authorization", headers(first)["Authorization"])
        connection.putheader("Content-Type", "multipart/form-data; boundary=slow")
        connection.putheader("Content-Length", "1000")
        connection.endheaders()
        try:
            deadline = time.monotonic() + 1
            while not app.state.supervisor.active_uploads and time.monotonic() < deadline:
                time.sleep(0.01)
            denied = submit(client, first)
            assert denied.status_code == 429 and denied.json()["detail"] == "installation_upload_in_progress"
            assert submit(client, second).status_code == 202
            assert connection.getresponse().status == 408
        finally:
            connection.close()


def test_cancel_key_is_durable_tenant_scoped_and_bounded(settings):
    app = api.create_app(settings)
    with TestClient(app) as client:
        a, b = register(client), register(client)
        response = client.delete("/v1/job-requests/same-key", headers=headers(a))
        assert response.status_code == 200 and response.json()["cancellationRecorded"]
        assert response.json()["jobId"] is None
        assert submit(client, a).json()["detail"] == "job_request_cancelled"
        assert submit(client, b).status_code == 202
        assert client.delete("/v1/job-requests/same-key", headers=headers(a)).status_code == 200
        with app.state.store.connection() as db:
            assert db.execute("SELECT count(*) FROM cancellations").fetchone()[0] == 1
            db.executemany("INSERT INTO cancellations VALUES(?,?,?)", [
                (a["installationId"], "capacity-" + str(i), time.time() + 1000) for i in range(127)])
        denied = client.delete("/v1/job-requests/new-key", headers=headers(a))
        assert denied.status_code == 429 and denied.json()["detail"] == "cancellation_capacity_exceeded"
    with TestClient(api.create_app(settings)) as restarted:
        assert submit(restarted, a).json()["detail"] == "job_request_cancelled"


def multipart_request(installation, key):
    request = httpx.Request("POST", "http://localhost/v1/jobs", headers=headers(installation),
                            files={"file": ("file.wav", AUDIO, "audio/wav")},
                            data={"language": "en", "idempotency_key": key,
                                  "audio_sha256": hashlib.sha256(AUDIO).hexdigest()})
    body = request.read()
    return request.headers, body


def test_real_tcp_cancel_key_wins_before_delayed_upload_commits(settings):
    app = api.create_app(settings)
    with tcp_server(app) as (base, port), httpx.Client(base_url=base, timeout=5, trust_env=False) as client:
        installation = register(client)
        upload_headers, body = multipart_request(installation, "late-upload")
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        connection.putrequest("POST", "/v1/jobs")
        for name in ("Authorization", "Content-Length", "Content-Type"):
            connection.putheader(name, upload_headers[name])
        connection.endheaders()
        halfway = len(body) // 2
        connection.send(body[:halfway])
        try:
            deadline = time.monotonic() + 1
            while not app.state.supervisor.active_uploads and time.monotonic() < deadline:
                time.sleep(0.01)
            cancelled = client.delete("/v1/job-requests/late-upload", headers=headers(installation))
            assert cancelled.status_code == 200 and cancelled.json()["jobId"] is None
            connection.send(body[halfway:])
            result = connection.getresponse()
            assert result.status == 409 and json.loads(result.read())["detail"] == "job_request_cancelled"
        finally:
            connection.close()
        assert app.state.store.count_queued() == 0
        assert app.state.store.by_key("late-upload", installation["installationId"]) is None
        assert app.state.store.pending_uploads() == []


def test_real_tcp_cancel_key_resolves_job_after_unread_response(settings):
    app = api.create_app(settings)
    with tcp_server(app) as (base, port), httpx.Client(base_url=base, timeout=5, trust_env=False) as client:
        installation = register(client)
        upload_headers, body = multipart_request(installation, "lost-response")
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        connection.request("POST", "/v1/jobs", body=body, headers={
            name: upload_headers[name] for name in ("Authorization", "Content-Length", "Content-Type")})
        try:
            deadline = time.monotonic() + 2
            while app.state.store.by_key("lost-response", installation["installationId"]) is None and time.monotonic() < deadline:
                time.sleep(0.01)
            assert app.state.store.by_key("lost-response", installation["installationId"]) is not None
            # Drop the connection without ever reading the POST response or its server job ID.
        finally:
            connection.close()
        cancelled = client.delete("/v1/job-requests/lost-response", headers=headers(installation))
        assert cancelled.status_code == 200 and cancelled.json()["jobStatus"] == "cancelled"
        assert not (settings.jobs_dir / cancelled.json()["jobId"]).exists()
        assert submit(client, installation, "lost-response").json()["detail"] == "job_request_cancelled"
