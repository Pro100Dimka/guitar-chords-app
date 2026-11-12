#!/usr/bin/env python3
"""Download two licensed sung recordings for Ukrainian/Russian smoke testing.

Run from any directory: python scripts/download_slavic_smoke.py
Requires FFmpeg on PATH; otherwise uses only the Python standard library.
Downloads/derivatives stay in ignored backend/data/evaluation/slavic.
This does not run inference or manufacture reference words, chords or timings.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from urllib.parse import quote
from urllib.request import Request, urlopen
import wave


SOURCES = [
    {
        "id": "uk_lysenko_dnieper",
        "language": "uk",
        "name": "Mykola Lysenko - The Dnieper River Rages.flac",
        "storagePrefix": "3/37",
        "title": "Реве та стогне Дніпр широкий",
        "performers": "Pavlo Hunka (bass-baritone), Albert Kravolt (piano)",
        "recorded": "2010",
        "license": "CC-BY-SA-4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
        "lyricsSource": "https://uk.wikisource.org/wiki/" + quote("Кобзар_(1922)/Причинна"),
        "sourceSha256": "079fbf8bd9e173509d04b595531ba58d2a5a7d6899c7281f1189615d7bb214f0",
        "sourceBytes": 9801736,
        "expectedDurationSeconds": 125.24,
        "notes": (
            "Music by Mykola Lysenko; words from Taras Shevchenko's poem. "
            "Recording permission confirmed by Wikimedia VRT ticket 2015051510022867. "
            "Credit performers and Ukrainian Art Song Project; retain CC-BY-SA-4.0 "
            "and disclose the WAV conversion when redistributing the recording. "
            "The published poem is not a verified transcript of this performance."
        ),
    },
    {
        "id": "ru_kalinka_1910",
        "language": "ru",
        "name": "Калинка. Альберт Янпольский (IA 78 kalinka albert-janpolski gbia0420126a).flac",
        "storagePrefix": "3/3b",
        "title": "Калинка",
        "performers": "Albert Janpolski; Victor Records",
        "recorded": "1910",
        "license": "PD-US-record-expired (Commons declaration)",
        "licenseUrl": "https://commons.wikimedia.org/wiki/Template:PD-US-record-expired",
        "lyricsSource": "https://ru.wikisource.org/wiki/" + quote("Калинка"),
        "sourceSha256": "f098385152f325604d064450c4469c05870c46bc4b478d3b3514c80c1a89ce57",
        "sourceBytes": 48447956,
        "expectedDurationSeconds": 123.52540625,
        "notes": (
            "Historical male vocal recording. Commons declares the 1910 recording "
            "public domain in the US; source attribution is Victor Records. "
            "Human lyric text is available on Wikisource but performance order, "
            "verses and repetitions have not been checked against this recording. "
            "The cited Internet Archive original returned404 during collection; "
            "this script uses the available Commons copy."
        ),
    },
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, destination: Path, limit: int, expected_hash=None):
    if destination.exists():
        if expected_hash and sha256(destination) != expected_hash:
            raise RuntimeError(f"Existing file checksum differs: {destination}")
        return
    temporary = destination.with_suffix(destination.suffix + ".part")
    try:
        request = Request(url, headers={"User-Agent": "FreeTune-evaluation/1.0"})
        with urlopen(request, timeout=45) as response, temporary.open("wb") as output:
            size = 0
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise RuntimeError(f"Download exceeds expected size: {url}")
                output.write(chunk)
        if expected_hash and sha256(temporary) != expected_hash:
            raise RuntimeError(f"Downloaded recording checksum differs: {url}")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def prepare(source: dict, folder: Path, ffmpeg: str) -> dict:
    item = dict(source)
    name = quote(item["name"].replace(" ", "_"))
    item["sourcePage"] = "https://commons.wikimedia.org/wiki/File:" + name
    item["downloadUrl"] = (
        "https://upload.wikimedia.org/wikipedia/commons/"
        + item.pop("storagePrefix") + "/" + name
    )
    original = folder / (item["id"] + ".flac")
    download(item["downloadUrl"], original, item["sourceBytes"], item["sourceSha256"])
    wav = folder / (item["id"] + ".wav")
    if not wav.exists():
        temporary = folder / (item["id"] + ".part.wav")
        try:
            subprocess.run([
                ffmpeg, "-v", "error", "-y", "-threads", "1", "-i", str(original),
                "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", str(temporary),
            ], check=True, timeout=120)
            temporary.replace(wav)
        finally:
            temporary.unlink(missing_ok=True)
    with wave.open(str(wav), "rb") as audio:
        if (audio.getnchannels(), audio.getframerate(), audio.getsampwidth()) != (1, 44100, 2):
            raise RuntimeError(f"Unexpected WAV format: {wav}")
        duration = audio.getnframes() / audio.getframerate()
    if abs(duration - item["expectedDurationSeconds"]) > 0.02:
        raise RuntimeError(f"Unexpected WAV duration: {wav}")
    item.update(
        wavFile=wav.name, wavSha256=sha256(wav), durationSeconds=duration,
        conversion="Full recording converted to mono44.1kHz PCM16 WAV; no trimming, silence removal or time stretching.",
        purpose="RU/UK language smoke only; no human alignment/chord ground truth. This script runs no inference.",
    )
    for suffix, url in [("source", item["sourcePage"]), ("lyrics-source", item["lyricsSource"])]:
        try:
            download(url, folder / (item["id"] + "-" + suffix + ".html"), 2 * 1024 * 1024)
        except (OSError, RuntimeError) as error:
            # A primary page can be inspected at its recorded URL even if caching fails.
            item.setdefault("pageCacheErrors", []).append(str(error))
    print(f"{item['id']}: {duration:.3f}s, WAV SHA256 {item['wavSha256']}", flush=True)
    return item


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir", type=Path,
        default=Path(__file__).resolve().parents[1] / "backend/data/evaluation/slavic",
    )
    args = parser.parse_args()
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        parser.error("Install FFmpeg and ensure ffmpeg is on PATH")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    items = [prepare(source, args.output_dir, ffmpeg) for source in SOURCES]
    manifest = args.output_dir / "sources.json"
    manifest.write_text(json.dumps({
        "date": datetime.now(timezone.utc).date().isoformat(), "sources": items,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(manifest)
    benchmark = args.output_dir / "manifest.json"
    benchmark.write_text(json.dumps({
        "corpus": {"name": "Wikimedia Slavic language smoke", "humanGroundTruth": False},
        "recordings": [{
            "id": item["id"], "audio": item["wavFile"], "language": item["language"],
            "reference": None, "source": item["sourcePage"], "license": item["license"],
        } for item in items],
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(benchmark)


if __name__ == "__main__":
    main()
