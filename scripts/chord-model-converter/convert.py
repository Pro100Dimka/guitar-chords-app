#!/usr/bin/env python3
"""Reproduce the pinned BasicPitch NNEF asset; no application runtime dependency.

Python's standard library validates the official ONNX source and canonical
NNEF output. Cargo.lock pins the separate build-only Rust converter.
"""

import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request


ROOT = Path(__file__).resolve().parent
SOURCE_URL = "https://raw.githubusercontent.com/spotify/basic-pitch/fa5997af0a8210982619003269994a1be25eddf3/basic_pitch/saved_models/icassp_2022/nmp.onnx"
SOURCE_BYTES = 230444
SOURCE_SHA256 = "2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec"
OUTPUT_BYTES = 196096
OUTPUT_SHA256 = "274e46d8b4eec2d6a9da1d52d60744feb7f7dfdf6207dc12db10f5ddd9f3416f"


def verify(path, size, digest):
    data = path.read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if len(data) != size or actual != digest:
        raise ValueError(f"Unexpected contents in {path}: {len(data)} bytes, SHA-256 {actual}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Existing official nmp.onnx; otherwise download the pinned source")
    parser.add_argument("--output", type=Path, required=True, help="Destination NNEF tar, written only after hash validation")
    parser.add_argument("--cargo", default=os.environ.get("CARGO", "cargo"))
    parser.add_argument("--target-dir", type=Path, help="Optional Cargo build cache outside this converter directory")
    parser.add_argument("--offline", action="store_true", help="Require --source and cached Cargo dependencies; make no network requests")
    args = parser.parse_args()
    if args.offline and args.source is None:
        parser.error("--offline requires --source")
    if args.source and args.source.resolve() == args.output.resolve():
        parser.error("Source ONNX and output NNEF paths must differ")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="chord-model-", dir=args.output.parent) as temporary:
        temporary = Path(temporary).resolve()
        source = args.source.resolve() if args.source else temporary / "nmp.onnx"
        if args.source is None:
            with urllib.request.urlopen(SOURCE_URL, timeout=45) as response:
                source.write_bytes(response.read(SOURCE_BYTES + 1))
        verify(source, SOURCE_BYTES, SOURCE_SHA256)
        converted = temporary / "model.nnef.tar"
        command = [args.cargo, "run", "--release", "--locked", "--manifest-path", str(ROOT / "Cargo.toml")]
        if args.offline:
            command.append("--offline")
        if args.target_dir:
            command += ["--target-dir", str(args.target_dir.resolve())]
        command += ["--", str(source), str(converted)]
        subprocess.run(command, check=True)
        verify(converted, OUTPUT_BYTES, OUTPUT_SHA256)
        os.replace(converted, args.output)
    print(f"Verified {args.output}: {OUTPUT_BYTES} bytes; SHA-256 {OUTPUT_SHA256}")


if __name__ == "__main__":
    main()
