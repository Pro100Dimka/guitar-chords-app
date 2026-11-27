#!/usr/bin/env python3
"""Fetch the pinned offline-chord test fixtures without downloading a dataset.

Uses HTTP Range to extract one GuitarSet WAV and its JAMS from the official
archives, then verifies their SHA-256. No media is placed in app assets.
"""

import argparse
import hashlib
import io
import json
import re
import urllib.request
import zipfile
from pathlib import Path


MAX_READ = 16 * 1024 * 1024
MANIFEST = Path(__file__).resolve().parents[1] / "docs/offline-chord-analysis-fixtures.json"


class RangeReader(io.RawIOBase):
    def __init__(self, url):
        self.url = url
        self.position = 0
        self.downloaded = 0
        self.cache = []
        start, size, data = self.request("bytes=-65536")
        self.size = size
        self.cache.append((start, data))

    def request(self, byte_range):
        request = urllib.request.Request(self.url, headers={"Range": byte_range})
        with urllib.request.urlopen(request, timeout=45) as response:
            match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
            if response.status != 206 or not match:
                raise ValueError("Server must support HTTP Range; refusing a full dataset download")
            start, end, size = map(int, match.groups())
            if end - start + 1 > MAX_READ:
                raise ValueError("Requested archive section exceeds the fixture size limit")
            data = response.read(end - start + 2)
            if len(data) != end - start + 1:
                raise ValueError("Truncated or oversized HTTP range response")
            self.downloaded += len(data)
            return start, size, data

    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        if self.position < 0:
            raise ValueError("Negative archive offset")
        return self.position

    def tell(self):
        return self.position

    def seekable(self):
        return True

    def readable(self):
        return True

    def read(self, count=-1):
        count = self.size - self.position if count < 0 else min(count, self.size - self.position)
        if count <= 0:
            return b""
        if count > MAX_READ:
            raise ValueError("Requested archive section exceeds the fixture size limit")
        start, end = self.position, self.position + count
        for offset, data in self.cache:
            if offset <= start and end <= offset + len(data):
                self.position = end
                return data[start - offset:end - offset]
        offset, size, data = self.request(f"bytes={start}-{end - 1}")
        if offset != start or size != self.size or len(data) != count:
            raise ValueError("Server returned a different archive range")
        self.cache.append((offset, data))
        self.position = end
        return data


def verified(data, metadata):
    return len(data) == metadata["bytes"] and hashlib.sha256(data).hexdigest() == metadata["sha256"]


def fetch(metadata, output_dir):
    name = Path(metadata.get("member") or metadata["file"]).name
    output = output_dir / name
    if output.exists():
        if not verified(output.read_bytes(), metadata):
            raise ValueError("Existing fixture has unexpected contents: " + str(output))
        print("Verified existing " + str(output))
        return
    if "archive" in metadata:
        with RangeReader(metadata["archive"]) as remote:
            with zipfile.ZipFile(remote) as archive:
                entry = archive.getinfo(metadata["member"])
                if entry.file_size != metadata["bytes"] or entry.compress_size > MAX_READ:
                    raise ValueError("Archive member does not match the pinned fixture")
                data = archive.read(entry)
            downloaded = remote.downloaded
    else:
        with urllib.request.urlopen(metadata["url"], timeout=45) as response:
            data = response.read(metadata["bytes"] + 1)
        downloaded = len(data)
    if not verified(data, metadata):
        raise ValueError("Fixture size or SHA-256 mismatch: " + name)
    output.write_bytes(data)
    print(f"Verified {output} ({len(data)} bytes; {downloaded} downloaded)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--include-song", action="store_true", help="Also fetch the existing ShazamIO full-song fixture for smoke testing")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    fixtures = json.loads(MANIFEST.read_text())["fixtures"]
    fetch(fixtures[0]["audio"], args.output_dir)
    fetch(fixtures[0]["annotation"], args.output_dir)
    if args.include_song:
        fetch(fixtures[1]["audio"], args.output_dir)


if __name__ == "__main__":
    main()
