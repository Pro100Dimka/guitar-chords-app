#!/usr/bin/env python3
"""Copy pinned chord-runtime license texts into the offline Settings asset.

Requires the locked crates in Cargo's local cache. Build/dev edges and
proc-macro-only crates are excluded. The six supported mobile targets are
resolved separately and their normal library dependency sets are combined.
This copies redistribution metadata; it does not assess license compatibility.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "android/song-fingerprint/Cargo.toml"
OUTPUT = ROOT / "assets/offline-chords-notices.json"
EXTRA_SOURCES = ROOT / "scripts/offline-chords-license-sources.json"
TARGETS = (
    "armv7-linux-androideabi",
    "aarch64-linux-android",
    "x86_64-linux-android",
    "aarch64-apple-ios",
    "aarch64-apple-ios-sim",
    "x86_64-apple-ios",
)
LICENSE_NAME = re.compile(r"^(licen[cs]es?|copying|notice|copyright)(?:[._-].*)?$", re.I)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def runtime_closure(metadata: dict) -> tuple[dict, set[str]]:
    packages = {package["id"]: package for package in metadata["packages"]}
    nodes = {node["id"]: node for node in metadata["resolve"]["nodes"]}
    project = nodes[metadata["resolve"]["root"]]
    seeds = [dep["pkg"] for dep in project["deps"] if packages[dep["pkg"]]["name"] == "tract-nnef"]
    if len(seeds) != 1:
        raise ValueError("Expected one direct tract-nnef dependency in the mobile crate")
    found, excluded = {}, set()
    pending = seeds
    while pending:
        identifier = pending.pop()
        if identifier in found:
            continue
        package = packages[identifier]
        if any("proc-macro" in target["kind"] for target in package["targets"]):
            excluded.add(f"{package['name']} {package['version']}")
            continue
        found[identifier] = package
        for dependency in nodes[identifier]["deps"]:
            if any(kind["kind"] is None for kind in dependency["dep_kinds"]):
                pending.append(dependency["pkg"])
    return found, excluded


def source_files(package: dict) -> list[Path]:
    directory = Path(package["manifest_path"]).parent.resolve()
    files = set()
    for entry in directory.iterdir():
        if not LICENSE_NAME.fullmatch(entry.name):
            continue
        if entry.is_file():
            files.add(entry)
        elif entry.is_dir():
            files.update(path for path in entry.rglob("*") if path.is_file())
    if package["license_file"]:
        explicit = Path(package["license_file"])
        files.add(explicit if explicit.is_absolute() else directory / explicit)
    for path in files:
        if not path.resolve().is_relative_to(directory):
            raise ValueError(f"License path leaves the published crate: {package['name']} / {path.name}")
    return sorted(files)


def generate(cargo: str) -> tuple[dict, dict]:
    packages, excluded, platform_packages = {}, set(), {}
    for target in TARGETS:
        command = [cargo, "metadata", "--manifest-path", str(MANIFEST), "--locked", "--offline",
                   "--format-version", "1", "--filter-platform", target]
        metadata = json.loads(subprocess.check_output(command, text=True))
        closure, skipped = runtime_closure(metadata)
        packages.update(closure)
        excluded.update(skipped)
        platform_packages[target] = sorted(f"{p['name']}@{p['version']}" for p in closure.values())

    extra_sources = json.loads(EXTRA_SOURCES.read_text())
    texts, components, missing = {}, [], []
    literal_bytes = 0

    def add_document(name: str, data: bytes, source: str) -> dict:
        nonlocal literal_bytes
        literal_bytes += len(data)
        digest = sha256(data)
        texts.setdefault(digest, {"sha256": digest, "text": data.decode("utf-8")})
        return {"name": name, "sha256": digest, "source": source}

    model_directory = ROOT / "android/song-fingerprint/models/basic-pitch"
    components.append({
        "id": "basic-pitch", "name": "Basic Pitch", "license": "Apache-2.0",
        "source": "https://github.com/spotify/basic-pitch",
        "sourceCommit": "fa5997af0a8210982619003269994a1be25eddf3",
        "documents": [add_document(name, (model_directory / name).read_bytes(),
                                   f"android/song-fingerprint/models/basic-pitch/{name}")
                      for name in ("LICENSE", "NOTICE")],
    })
    # Keep the model and its inference-engine attribution first, then helpers.
    ordered = sorted(packages.values(), key=lambda p: (not p["name"].startswith("tract-"), p["name"], p["version"]))
    for package in ordered:
        identifier = f"{package['name']}@{package['version']}"
        directory = Path(package["manifest_path"]).parent
        documents = [
            add_document(path.relative_to(directory).as_posix(), path.read_bytes(),
                         f"https://docs.rs/crate/{package['name']}/{package['version']}/source/{path.relative_to(directory).as_posix()}")
            for path in source_files(package)
        ]
        for extra in extra_sources.get(identifier, []):
            data = extra["text"].encode("utf-8")
            if sha256(data) != extra["sha256"]:
                raise ValueError(f"Pinned upstream license hash mismatch: {identifier}")
            documents.append(add_document(extra["name"], data, extra["source"]))
        if not documents:
            missing.append(identifier)
        components.append({
            "id": identifier, "name": f"{package['name']} {package['version']}",
            "license": package["license"],
            "source": f"https://crates.io/crates/{package['name']}/{package['version']}",
            "documents": documents,
        })
    if missing:
        raise ValueError("Missing original license text: " + ", ".join(missing))

    result = {
        "version": 2,
        "coverage": "Basic Pitch model and the normal library dependencies reachable from tract-nnef on the listed mobile targets. Other application components, build/dev dependencies and proc-macro-only crates are outside this inventory.",
        "generator": "scripts/collect-offline-chords-notices.py",
        "cargoLockSha256": sha256(MANIFEST.with_name("Cargo.lock").read_bytes()),
        "targets": list(TARGETS),
        "platformPackages": platform_packages,
        "excludedProcMacroCrates": sorted(excluded),
        "components": components,
        "documents": list(texts.values()),
    }
    report = {
        "runtimePackages": len(packages), "componentsIncludingModel": len(components),
        "documentReferences": sum(len(c["documents"]) for c in components),
        "uniqueDocuments": len(texts), "literalBytesBeforeDeduplication": literal_bytes,
        "literalBytesAfterDeduplication": sum(len(d["text"].encode()) for d in texts.values()),
        "missingLicenseTexts": missing,
    }
    return result, report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cargo", default="cargo")
    parser.add_argument("--check", action="store_true", help="Verify the existing asset without writing it")
    args = parser.parse_args()
    generated, report = generate(args.cargo)
    if args.check:
        if json.loads(OUTPUT.read_text()) != generated:
            raise ValueError("Offline chord notices are stale; rerun this script without --check")
    else:
        OUTPUT.write_text(json.dumps(generated, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
