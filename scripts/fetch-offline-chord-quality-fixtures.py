#!/usr/bin/env python3
"""Fetch twelve pinned GuitarSet takes through HTTP Range, without full archives.

Media stays in the explicitly selected output directory, outside app assets.
Requires ffmpeg only when --decode is supplied. Reuses the bounded RangeReader
and SHA-256 checks from the original single-fixture downloader.
"""

import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import subprocess
import zipfile
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
MANIFEST = REPO / "docs/offline-chord-quality-fixtures.json"
spec = importlib.util.spec_from_file_location("fixture_fetcher", REPO / "scripts/fetch-offline-chord-fixtures.py")
fetcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetcher)


def acquire(fixtures, kind, destination):
    destination.mkdir(parents=True, exist_ok=True)
    metadata = [fixture[kind] for fixture in fixtures]
    urls = {item["archive"] for item in metadata}
    if len(urls) != 1:
        raise ValueError("Expected one official source archive per fixture type")
    missing = []
    for item in metadata:
        path = destination / Path(item["member"]).name
        if path.exists():
            if not fetcher.verified(path.read_bytes(), item):
                raise ValueError("Existing fixture has unexpected contents: " + str(path))
        else:
            missing.append(item)
    if not missing:
        return 0
    with fetcher.RangeReader(urls.pop()) as remote:
        with zipfile.ZipFile(remote) as archive:
            for item in missing:
                member = archive.getinfo(item["member"])
                if member.file_size != item["bytes"] or member.compress_size > fetcher.MAX_READ:
                    raise ValueError("Archive member does not match pinned fixture")
                data = archive.read(member)
                if not fetcher.verified(data, item):
                    raise ValueError("Fixture size or SHA-256 mismatch: " + item["member"])
                (destination / Path(item["member"]).name).write_bytes(data)
                print("Verified " + item["member"], flush=True)
        return remote.downloaded


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--decode", action="store_true", help="Use ffmpeg to create 16 kHz mono signed-16-bit little-endian PCM")
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text())
    fixtures = manifest["fixtures"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(acquire, fixtures, kind, args.output_dir / directory)
                   for kind, directory in (("audio", "audio"), ("annotation", "annotations"))]
        transferred = sum(future.result() for future in futures)
    pcm = []
    if args.decode:
        directory = args.output_dir / "pcm"
        directory.mkdir(exist_ok=True)
        for fixture in fixtures:
            source = args.output_dir / "audio" / Path(fixture["audio"]["member"]).name
            target = directory / (fixture["track"] + ".pcm")
            subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(source),
                            "-ar", "16000", "-ac", "1", "-f", "s16le", str(target)], check=True)
            data = target.read_bytes()
            pcm.append({"track": fixture["track"], "path": str(target.resolve()),
                        "bytes": len(data), "durationSeconds": len(data) / 32000,
                        "sha256": hashlib.sha256(data).hexdigest()})
    (args.output_dir / "prepared-inputs.json").write_text(json.dumps({
        "sourceManifestSha256": hashlib.sha256(MANIFEST.read_bytes()).hexdigest(),
        "downloadedBytes": transferred, "pcm": pcm}, indent=2) + "\n")
    print(f"Verified {len(fixtures)} WAV/JAMS pairs; transferred {transferred} bytes.")


if __name__ == "__main__":
    main()
