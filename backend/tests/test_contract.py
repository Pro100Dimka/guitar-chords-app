import asyncio
import hashlib
import io
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import sys
import time
from types import SimpleNamespace
import wave

from fastapi.testclient import TestClient
import pytest
import psutil

from freetune_analysis.app import create_app
from freetune_analysis.config import Settings
from freetune_analysis.pipeline import (AnalysisError, analyze, chord_label, decode_audio, disjoint_lyrics,
                                       remove_non_lyric_captions)
from freetune_analysis.store import JobStore, ConflictError
from freetune_analysis.supervisor import Supervisor


async def idle_supervisor(self):
    await asyncio.Event().wait()


def wav_bytes():
    output = io.BytesIO()
    with wave.open(output, "wb") as writer:
        writer.setparams((1, 2, 22050, 0, "NONE", "not compressed"))
        samples = [0 if i < 11025 else int(9000 * math.sin(i * 2 * math.pi * 440 / 22050))
                   for i in range(44100)]
        writer.writeframes(struct.pack("<" + "h" * len(samples), *samples))
    return output.getvalue()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(Supervisor, "run", idle_supervisor)
    app = create_app(Settings(data_dir=tmp_path, token="test-token"))
    with TestClient(app, headers={"Authorization": "Bearer test-token"}) as client:
        yield client


def post_audio(client, audio=None, **fields):
    audio = wav_bytes() if audio is None else audio
    data = {"language": "en", "idempotency_key": "test-key",
            "audio_sha256": hashlib.sha256(audio).hexdigest(), **fields}
    return client.post("/v1/jobs", files={"file": ("song.wav", audio, "audio/wav")}, data=data)


def test_upload_retry_is_idempotent_and_binds_original_bytes(client):
    a, b = post_audio(client), post_audio(client)
    assert a.status_code == b.status_code == 202
    assert a.json()["id"] == b.json()["id"]
    assert a.json()["audio_sha256"] == hashlib.sha256(wav_bytes()).hexdigest()
    assert a.json()["idempotency_key"] == "test-key"
    conflict = post_audio(client, audio=wav_bytes() + b"changed")
    assert conflict.status_code == 409


def test_wrong_hash_and_unsupported_language_are_rejected_without_jobs(client):
    assert post_audio(client, audio_sha256="0" * 64).status_code == 422
    assert post_audio(client, language="fr").status_code == 422
    assert client.app.state.store.count_queued() == 0


def test_authentication_runs_before_upload_parsing(client):
    response = client.post("/v1/jobs", content=b"not multipart", headers={"Authorization": "Bearer wrong"})
    assert response.status_code == 401


def test_empty_upload_and_extension(client):
    assert post_audio(client, audio=b"").status_code == 422
    response = client.post("/v1/jobs", files={"file": ("x.exe", wav_bytes())}, data={
        "language": "en", "idempotency_key": "ext", "audio_sha256": "0" * 64})
    assert response.status_code == 415


def test_cancel_deletes_audio_and_retry_keeps_one_row(client):
    first = post_audio(client).json()
    folder = client.app.state.supervisor.settings.jobs_dir / first["id"]
    assert folder.exists()
    assert client.delete("/v1/jobs/" + first["id"]).json()["status"] == "cancelled"
    assert not folder.exists()
    retried = post_audio(client).json()
    assert retried["id"] == first["id"]
    assert retried["status"] == "queued"
    assert client.app.state.store.count_queued() == 1


def test_delete_completed_is_cleanup_not_loss_of_result(client):
    job = post_audio(client).json()
    result = {"version": 1, "duration": 2, "lyrics": [], "chords": [{"start": 0, "end": 2, "label": "A"}]}
    client.app.state.store.update(job["id"], status="completed", stage="done", progress=1, result=result)
    response = client.delete("/v1/jobs/" + job["id"]).json()
    assert response["status"] == "completed"
    assert response["result"] == result


def test_restart_preserves_finished_result_and_marks_inflight_interrupted(tmp_path, monkeypatch):
    monkeypatch.setattr(Supervisor, "run", idle_supervisor)
    settings = Settings(data_dir=tmp_path)
    first_app = create_app(settings)
    with TestClient(first_app) as first:
        queued = post_audio(first, idempotency_key="queued").json()
        finished = post_audio(first, idempotency_key="finished").json()
        first_app.state.store.update(finished["id"], status="completed", stage="done", progress=1,
                                     result={"user": "preserved"})
    with TestClient(create_app(settings)) as second:
        assert second.get("/v1/jobs/" + queued["id"]).json()["status"] == "interrupted"
        assert second.get("/v1/jobs/" + finished["id"]).json()["result"] == {"user": "preserved"}
        assert post_audio(second, idempotency_key="queued").json()["id"] == queued["id"]


def test_late_result_cannot_resurrect_cancelled_job(client):
    job = post_audio(client).json()
    client.delete("/v1/jobs/" + job["id"])
    client.app.state.store.update(job["id"], status="completed", stage="done", progress=1,
                                  result={"incorrect": "late result"})
    assert client.get("/v1/jobs/" + job["id"]).json()["status"] == "cancelled"


def test_retry_cannot_race_terminating_process(client):
    job = post_audio(client).json()
    supervisor = client.app.state.supervisor
    supervisor.store.update(job["id"], status="cancelled", stage="cancelled", progress=0)
    supervisor.active_id = job["id"]
    try:
        assert post_audio(client).status_code == 409
    finally:
        supervisor.active_id = None


@pytest.mark.parametrize("extension", ["wav", "mp3", "m4a"])
def test_decoding_preserves_intro_and_original_timeline(tmp_path, extension):
    original = tmp_path / "original.wav"
    original.write_bytes(wav_bytes())
    source = tmp_path / ("song." + extension)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(original), str(source)], check=True)
    decoded = tmp_path / "decoded.wav"
    duration = decode_audio(source, decoded, Settings(data_dir=tmp_path))
    assert abs(duration - 2) < 0.1
    with wave.open(str(decoded), "rb") as audio:
        values = struct.unpack("<" + "h" * audio.getnframes(), audio.readframes(audio.getnframes()))
    first_loud = next(i for i, value in enumerate(values) if abs(value) > 1000) / 22050
    assert 0.46 < first_loud < 0.56


def test_corrupt_file_fails_safely(tmp_path):
    source = tmp_path / "bad.mp3"
    source.write_bytes(b"not an audio file")
    with pytest.raises(AnalysisError, match="invalid_audio"):
        decode_audio(source, tmp_path / "decoded.wav", Settings(data_dir=tmp_path))


def test_duration_limit_rejects_without_truncating_song(tmp_path):
    source = tmp_path / "long.wav"
    source.write_bytes(wav_bytes())
    with pytest.raises(AnalysisError, match="audio_too_long"):
        decode_audio(source, tmp_path / "decoded.wav", Settings(data_dir=tmp_path, max_duration_seconds=1))


@pytest.mark.parametrize("source,expected", [
    ("C:maj", "C"), ("F#:min", "F#m"), ("Bb:min7", "Bbm7"), ("C:maj/3", "C/E"),
    ("D:min/b7", "Dm/C"), ("C:maj(9,#11)", "C:maj(9,#11)"), ("N", "N"), ("X", "?"),
])
def test_recognized_chord_quality_and_bass_are_preserved(source, expected):
    assert chord_label(source) == expected


def test_invalid_word_alignment_is_not_repaired_by_squeezing():
    lines = [{"start": 2, "end": 5, "text": "long word", "words": [
        {"start": 2, "end": 4, "text": "long"}, {"start": 3, "end": 5, "text": "word"}]}]
    clean, unreliable = disjoint_lyrics(lines)
    assert unreliable and clean[0]["words"] == []
    assert clean[0]["start"] == 2 and clean[0]["end"] == 5
    assert clean[0]["text"] == "long word"


@pytest.mark.parametrize("caption", ["СПОКОЙНАЯ МЕЛОДИЯ", "[МУЗИКА]", "[Music]", "♪ ♫"])
def test_service_captions_are_not_sung_lyrics(caption):
    lines = [{"start": 23.94, "end": 26.74, "text": caption, "words": []},
             {"start": 34.14, "end": 41.26, "text": "Красавица! Душа девица!", "words": []}]
    filtered, omitted = remove_non_lyric_captions(lines)
    assert omitted == 1 and filtered == lines[1:]
    assert filtered[0]["start"] == 34.14 and filtered[0]["end"] == 41.26


def test_caption_filter_preserves_real_words_music_and_uppercase_lyrics():
    lines = [{"text": text} for text in ["Спокойная мелодия", "МУЗЫКА МОЕЙ ДУШИ",
                                        "♪ let the music play ♪", "[Remember me]", "I LOVE YOU"]]
    filtered, omitted = remove_non_lyric_captions(lines)
    assert filtered == lines and omitted == 0


def test_one_failed_analyzer_preserves_other_result(tmp_path, monkeypatch):
    import freetune_analysis.pipeline as pipeline
    monkeypatch.setattr(pipeline, "decode_audio", lambda *args: 10)
    monkeypatch.setattr(pipeline, "recognize_chords", lambda *args: [{"start": 3, "end": 7, "label": "Am"}])
    def lyrics_fail(*args):
        raise AnalysisError("lyrics_model_not_installed")
    monkeypatch.setattr(pipeline, "recognize_lyrics", lyrics_fail)
    states = []
    result = analyze(tmp_path / "song.wav", tmp_path, "uk", Settings(data_dir=tmp_path), states.append)
    assert states[-1]["status"] == "partial"
    assert result["chords"] == [{"start": 3, "end": 7, "label": "Am"}]
    assert result["lyrics"] == []
    assert result["warnings"] == ["lyrics_model_not_installed"]


def test_high_no_speech_score_does_not_delete_confident_singing(tmp_path, monkeypatch):
    import freetune_analysis.pipeline as pipeline
    segment = SimpleNamespace(start=0.2, end=1.7, no_speech_prob=0.85, avg_logprob=-0.2,
                              compression_ratio=1.1, words=[
        SimpleNamespace(start=0.2, end=0.7, word="тихо", probability=0.9),
        SimpleNamespace(start=0.7, end=1.7, word="співаю", probability=0.8)])
    class Recognizer:
        def __init__(self, *args, **kwargs):
            pass
        def transcribe(self, *args, **kwargs):
            return iter([segment]), SimpleNamespace(language="uk")
    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=Recognizer))
    monkeypatch.setattr(pipeline, "availability", lambda _: {"models": {"lyrics": {"ready": True}}})
    monkeypatch.setattr(pipeline, "capture_native_alignment", lambda _: lambda item: [
        {"word": word.word, "start": word.start, "end": word.end} for word in item.words])
    source = tmp_path / "sung.wav"
    source.write_bytes(wav_bytes())
    lines, language, warnings = pipeline.recognize_lyrics(
        source, 2, "uk", Settings(data_dir=tmp_path), lambda *args: None)
    assert language == "uk" and lines[0]["text"] == "тихо співаю"
    assert lines[0]["words"][1]["end"] == 1.7


def test_cancellation_stops_real_child_process(tmp_path, monkeypatch):
    real_popen = subprocess.Popen
    children = []
    def sleeper(*args, **kwargs):
        child = real_popen([sys.executable, "-c", "import time; time.sleep(30)"], **kwargs)
        children.append(child)
        return child
    monkeypatch.setattr(subprocess, "Popen", sleeper)

    async def exercise():
        settings = Settings(data_dir=tmp_path)
        store = JobStore(tmp_path / "jobs.sqlite3")
        manager = Supervisor(settings, store)
        await manager.start()
        upload = tmp_path / "upload"
        upload.write_bytes(wav_bytes())
        job = store.submit(key="cancel", sha256="a" * 64, language="en", filename="song.wav",
                           extension=".wav", upload=upload, jobs_dir=settings.jobs_dir)
        for _ in range(100):
            if manager.process:
                break
            await asyncio.sleep(0.02)
        assert manager.process is not None
        await manager.cancel(job["id"])
        assert children[0].poll() is not None
        assert store.get(job["id"])["status"] == "cancelled"
        assert not (settings.jobs_dir / job["id"]).exists()
        await manager.stop()
    asyncio.run(exercise())


@pytest.mark.parametrize("killed_process", ["server", "worker"])
def test_hard_kill_stops_worker_and_decoder_without_model_gil(tmp_path, killed_process):
    if killed_process == "worker" and os.name != "posix":
        pytest.skip("Orphaned decoder group cleanup is a POSIX facility")
    pid_file = tmp_path / "processes.json"
    worker_code = f"""
import json, os, pathlib, psutil, subprocess, sys, time
parent = psutil.Process(os.getppid())
decoder = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
watcher = subprocess.Popen([sys.executable, '-m', 'freetune_analysis.guard',
    '--parent', str(parent.pid), '--parent-created', str(parent.create_time()),
    '--worker', str(os.getpid()), '--worker-created', str(psutil.Process().create_time()),
    '--worker-group', str(os.getpgrp() if os.name == 'posix' else 0)],
    start_new_session=os.name != 'nt')
pathlib.Path({str(pid_file)!r}).write_text(json.dumps([os.getpid(), decoder.pid, watcher.pid]))
time.sleep(60)
"""
    parent_code = f"""
import os, subprocess, sys
p = subprocess.Popen([sys.executable, '-c', {worker_code!r}], start_new_session=os.name != 'nt')
p.wait()
"""
    parent = subprocess.Popen([sys.executable, "-c", parent_code], stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL)
    pids = []
    def running(pid):
        try:
            return psutil.Process(pid).status() != psutil.STATUS_ZOMBIE
        except psutil.NoSuchProcess:
            return False
    try:
        for _ in range(100):
            if pid_file.exists():
                break
            time.sleep(0.05)
        pids = json.loads(pid_file.read_text())
        if killed_process == "server":
            parent.kill()
        else:
            psutil.Process(pids[0]).kill()
        parent.wait(timeout=3)
        for _ in range(100):
            if not any(running(pid) for pid in pids):
                break
            time.sleep(0.05)
        assert not any(running(pid) for pid in pids)
    finally:
        if parent.poll() is None:
            parent.kill()
            parent.wait(timeout=3)
        for pid in pids:
            try:
                psutil.Process(pid).kill()
            except psutil.NoSuchProcess:
                pass
