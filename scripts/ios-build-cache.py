#!/usr/bin/env python3
"""Preserve Xcode input mtimes only when the cached input bytes are identical.

Git checkout, npm and CocoaPods recreate inputs with new mtimes on every runner.
The build cache can retain their original mtimes after checking their content,
without concealing changed, added or removed inputs from Xcode/Cargo.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
import time


ROOTS = ("ios", "node_modules", "android/song-fingerprint")
SKIP_DIRS = {".git", "__pycache__", "target"}
VERSION = 1


def valid_relative_path(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        return False
    path = PurePosixPath(value)
    if path.is_absolute() or path.as_posix() != value:
        return False
    if any(part in {".", ".."} | SKIP_DIRS for part in path.parts):
        return False
    return any(value.startswith(root + "/") for root in ROOTS)


def input_inventory(workspace):
    regular = {}
    symlinks = {}
    for relative_root in ROOTS:
        root = workspace / relative_root
        linked_root = False
        for parent in (root, *root.parents):
            if parent != workspace and workspace in parent.parents and parent.is_symlink():
                symlinks[parent.relative_to(workspace).as_posix()] = os.readlink(parent)
                linked_root = True
        if linked_root:
            continue
        if not root.is_dir():
            continue
        for directory, dirs, files in os.walk(root, followlinks=False):
            for name in (*dirs, *files):
                path = Path(directory) / name
                if name not in SKIP_DIRS and path.is_symlink():
                    symlinks[path.relative_to(workspace).as_posix()] = os.readlink(path)
            dirs[:] = sorted(name for name in dirs
                             if name not in SKIP_DIRS
                             and not (Path(directory) / name).is_symlink())
            for name in sorted(files):
                path = Path(directory) / name
                if not stat.S_ISREG(path.lstat().st_mode):
                    continue
                relative = path.relative_to(workspace).as_posix()
                if valid_relative_path(relative):
                    regular[relative] = path
    return regular, symlinks


def fingerprint(path):
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode):
        raise ValueError(f"Input is no longer a regular file: {path}")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    after = path.lstat()
    if (before.st_ino, before.st_size, before.st_mtime_ns, before.st_mode) != (
            after.st_ino, after.st_size, after.st_mtime_ns, after.st_mode):
        raise ValueError(f"Input changed while hashing: {path}")
    return {
        "sha256": digest.hexdigest(),
        "size": after.st_size,
        "mode": stat.S_IMODE(after.st_mode),
        "mtime_ns": after.st_mtime_ns,
    }, after


def validate_link_targets(workspace, symlinks):
    for relative in symlinks:
        try:
            resolved = (workspace / relative).resolve(strict=True)
            target = resolved.relative_to(workspace).as_posix()
        except (OSError, RuntimeError, ValueError) as error:
            raise ValueError(f"Uncovered symlink target: {relative}") from error
        if not valid_relative_path(target) and target not in ROOTS:
            raise ValueError(f"Symlink target is outside build inputs: {relative}")


def validate_manifest(data, workspace, now):
    if not isinstance(data, dict) or type(data.get("version")) is not int or data["version"] != VERSION:
        raise ValueError("Unknown input manifest version")
    if data.get("workspace") != str(workspace):
        raise ValueError("Input manifest belongs to a different workspace")
    created = data.get("created_ns")
    if type(created) is not int or not 0 < created <= now:
        raise ValueError("Invalid or future manifest timestamp")
    files = data.get("files")
    if not isinstance(files, dict) or not files:
        raise ValueError("Input manifest has no files")
    for relative, entry in files.items():
        if not valid_relative_path(relative) or not isinstance(entry, dict):
            raise ValueError("Invalid input manifest path")
        digest = entry.get("sha256")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError(f"Invalid input hash: {relative}")
        for key in ("size", "mode", "mtime_ns"):
            if type(entry.get(key)) is not int:
                raise ValueError(f"Invalid input metadata: {relative}")
        if entry["size"] < 0 or not 0 <= entry["mode"] <= 0o7777:
            raise ValueError(f"Invalid input size or mode: {relative}")
        if not 0 <= entry["mtime_ns"] <= created:
            raise ValueError(f"Invalid or future input timestamp: {relative}")
    symlinks = data.get("symlinks")
    if not isinstance(symlinks, dict):
        raise ValueError("Input manifest has no symlink inventory")
    for relative, target in symlinks.items():
        valid_path = valid_relative_path(relative) or relative in (*ROOTS, "android")
        if not valid_path or not isinstance(target, str) or not target or "\0" in target:
            raise ValueError("Invalid symlink inventory")
        if relative in files:
            raise ValueError("Conflicting input types in manifest")
    return files, symlinks


def save(workspace, manifest):
    regular, symlinks = input_inventory(workspace)
    validate_link_targets(workspace, symlinks)
    files = {relative: fingerprint(path)[0]
             for relative, path in regular.items()}
    data = {"version": VERSION, "workspace": str(workspace),
            "created_ns": time.time_ns(), "files": files, "symlinks": symlinks}
    validate_manifest(data, workspace, time.time_ns())
    manifest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=manifest.parent, delete=False) as output:
        temporary = Path(output.name)
        output.write(json.dumps(data, separators=(",", ":")) + "\n")
    try:
        temporary.replace(manifest)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Saved content fingerprints for {len(files)} build inputs")


def restore(workspace, manifest):
    data = json.loads(manifest.read_text())
    # Validate every entry before changing any input timestamps.
    files, old_links = validate_manifest(data, workspace, time.time_ns())
    regular, symlinks = input_inventory(workspace)
    validate_link_targets(workspace, symlinks)
    # A new header can shadow an old include without appearing in the previous
    # dependency graph. A structural change therefore requires a fresh build.
    if files.keys() != regular.keys() or old_links != symlinks:
        raise ValueError("Build input paths or symlink targets changed")
    restored = changed = 0
    for relative, path in regular.items():
        current, metadata = fingerprint(path)
        old = files.get(relative)
        identical = old is not None and all(current[key] == old[key]
                                            for key in ("sha256", "size", "mode"))
        # Changed sources can carry old archive mtimes. Make them newer than
        # the cached build, instead of allowing Xcode's stat check to miss them.
        mtime = old["mtime_ns"] if identical else time.time_ns()
        os.utime(path, ns=(metadata.st_atime_ns, mtime), follow_symlinks=False)
        restored += int(identical)
        changed += int(not identical)
    print(f"Restored {restored} identical input mtimes; refreshed {changed} changed inputs")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("save", "restore"))
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    workspace = args.workspace.resolve(strict=True)
    if not workspace.is_dir():
        raise ValueError("Workspace must be a directory")
    # The manifest is build state, never a source input. Keeping it outside the
    # scanned roots also prevents a snapshot from including its own prior copy.
    manifest = Path(os.path.abspath(args.manifest))
    if manifest.is_symlink() or any(parent.is_symlink() for parent in manifest.parents):
        raise ValueError("Manifest must not follow symlinks")
    if manifest.is_relative_to(workspace):
        relative = manifest.relative_to(workspace).as_posix()
        if valid_relative_path(relative):
            raise ValueError("Manifest must be outside build input roots")
    (save if args.operation == "save" else restore)(workspace, manifest)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f"Cannot reuse iOS build input timestamps: {error}", file=sys.stderr)
        sys.exit(1)
