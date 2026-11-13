#!/usr/bin/env python3
"""Reproduce the pinned ten-song UK/RU execution corpus, without reference lyrics.

Only the Python standard library and FFmpeg are required. Full recordings and
derived WAVs remain in ignored backend/data, never in application assets. Source
metadata/licenses are reviewed and pinned in docs/validation, not discovered at
inference time. This utility does not run a model or create human ground truth.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from urllib.request import Request, urlopen
import wave

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "docs/validation/slavic-corpus-v3-sources.json"


def digest(path, algorithm="sha256"):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, algorithm).hexdigest()


def download(source, destination):
    def verify(path):
        if path.stat().st_size != source["sourceBytes"]:
            raise ValueError("Source byte count changed: " + source["id"])
        if digest(path, "sha1") != source["sourceSha1"]:
            raise ValueError("Source checksum changed: " + source["id"])
        if source.get("sourceSha256") and digest(path) != source["sourceSha256"]:
            raise ValueError("Source SHA-256 changed: " + source["id"])

    if destination.exists():
        verify(destination)
        return
    temporary = destination.with_suffix(destination.suffix + ".part")
    try:
        request = Request(source["downloadUrl"], headers={"User-Agent": "FreeTune-evaluation/3.0"})
        with urlopen(request, timeout=90) as response, temporary.open("wb") as target:
            size = 0
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > source["sourceBytes"]:
                    raise ValueError("Source exceeds pinned size: " + source["id"])
                target.write(chunk)
        verify(temporary)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def prepare(source, folder, ffmpeg):
    original = folder / (source["id"] + Path(source["fileName"]).suffix)
    download(source, original)
    wav = folder / (source["id"] + ".wav")
    # Cache conversion only when tied to these exact source bytes and settings.
    conversion_key = folder / (source["id"] + ".conversion.json")
    expected = {"sourceSha256": digest(original), "rate": 44100, "channels": 1, "width": 2}
    cached = json.loads(conversion_key.read_text()) if conversion_key.exists() else {}
    if not (wav.exists() and all(cached.get(k) == v for k, v in expected.items())
            and cached.get("wavSha256") == digest(wav)):
        temporary = folder / (source["id"] + ".part.wav")
        try:
            subprocess.run([ffmpeg, "-v", "error", "-y", "-threads", "1", "-i", str(original),
                            "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", str(temporary)],
                           check=True, timeout=180)
            temporary.replace(wav)
        finally:
            temporary.unlink(missing_ok=True)
        conversion_key.write_text(json.dumps({**expected, "wavSha256": digest(wav)}) + "\n")
    with wave.open(str(wav), "rb") as stream:
        if (stream.getnchannels(), stream.getframerate(), stream.getsampwidth()) != (1, 44100, 2):
            raise ValueError("Unexpected WAV encoding: " + source["id"])
        duration = stream.getnframes() / stream.getframerate()
    if abs(duration - source["expectedDurationSeconds"]) > source.get("durationToleranceSeconds", 0.02):
        raise ValueError("Full-recording duration changed: " + source["id"])
    result = {**source, "audio": wav.name, "audioSha256": digest(wav),
              "sourceSha256": expected["sourceSha256"], "durationSeconds": duration,
              "conversion": "Full original to mono 44.1 kHz PCM16 WAV; no trimming, silence removal or time stretching."}
    print(f"{source['id']}: {duration:.3f}s", flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=ROOT / "backend/data/evaluation/slavic-v3")
    args = parser.parse_args()
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        parser.error("FFmpeg is required")
    definition = json.loads(SOURCES.read_text("utf-8"))
    args.directory.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        recordings = list(pool.map(lambda source: prepare(source, args.directory, ffmpeg), definition["sources"]))
    report = {"corpus": {"name": "Wikimedia UK/RU v3 execution corpus", "humanReferences": False,
                         "humanChordReferences": False, "splitPolicy": definition["splitPolicy"],
                         "definitionSha256": digest(SOURCES), "limitations": definition["limitations"]},
              "preparedAt": datetime.now(timezone.utc).isoformat(), "recordings": recordings}
    manifest = args.directory / "manifest.json"
    temporary = manifest.with_suffix(".part.json")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
    temporary.replace(manifest)
    print(manifest)


if __name__ == "__main__":
    main()
