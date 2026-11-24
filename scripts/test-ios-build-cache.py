#!/usr/bin/env python3
"""Exercise the build-input timestamp cache through its public command line."""

import copy
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
import unittest


HELPER = Path(__file__).resolve().with_name("ios-build-cache.py")
SECOND = 1_000_000_000


class BuildInputCacheTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ios-cache-test-")
        # macOS may spell the same temp ancestor /var or /private/var.
        self.base = Path(self.temporary.name).resolve()
        self.workspace = self.base / "workspace"
        self.workspace.mkdir()
        self.manifest = self.base / "cache" / "inputs.json"
        self.old_ns = time.time_ns() - 3600 * SECOND

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, relative, content=b"original", *, mode=0o644, mtime=None):
        path = self.workspace / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        path.chmod(mode)
        timestamp = self.old_ns if mtime is None else mtime
        os.utime(path, ns=(timestamp, timestamp))
        return path

    def run_cli(self, operation, *, manifest=None, succeeds=True):
        result = subprocess.run(
            [sys.executable, str(HELPER), operation,
             "--workspace", str(self.workspace),
             "--manifest", str(manifest or self.manifest)],
            capture_output=True, text=True, timeout=15,
        )
        message = f"{operation}: {result.stdout}\n{result.stderr}"
        if succeeds:
            self.assertEqual(result.returncode, 0, message)
        else:
            self.assertNotEqual(result.returncode, 0, message)
        return result

    def save(self):
        self.run_cli("save")
        return json.loads(self.manifest.read_text())

    def write_manifest(self, data):
        self.manifest.parent.mkdir(parents=True, exist_ok=True)
        self.manifest.write_text(json.dumps(data))

    def assert_fresh(self, path, since):
        self.assertGreaterEqual(path.stat().st_mtime_ns, since)
        self.assertLessEqual(path.stat().st_mtime_ns, time.time_ns())

    def invalid_fixture(self):
        existing = self.write("ios/first.swift", b"unchanged")
        later = self.write("node_modules/example/late.h", b"later input")
        data = self.save()
        # A non-atomic implementation would restore this first entry before
        # noticing bad metadata on the second existing entry. Keep the inventory
        # identical so structural invalidation cannot mask validation failures.
        changed_time = self.old_ns + 10 * SECOND
        os.utime(existing, ns=(changed_time, changed_time))
        os.utime(later, ns=(changed_time, changed_time))
        return data, [existing, later]

    def assert_rejected_without_touching(self, paths, *, manifest=None):
        before = {path: (path.stat().st_mtime_ns, path.read_bytes())
                  for path in paths}
        self.run_cli("restore", manifest=manifest, succeeds=False)
        after = {path: (path.stat().st_mtime_ns, path.read_bytes())
                 for path in paths}
        self.assertEqual(after, before)

    def test_identical_inputs_restore_original_mtimes_in_all_roots(self):
        paths = [
            self.write("ios/App.swift"),
            self.write("ios/build/generated/NativeSpec.h", b"generated", mtime=0),
            self.write("node_modules/example/index.js", b"module"),
            self.write("android/song-fingerprint/src/lib.rs", b"rust"),
        ]
        original_times = {path: path.stat().st_mtime_ns for path in paths}
        data = self.save()
        self.assertEqual(data["version"], 1)
        self.assertEqual(data["workspace"], str(self.workspace))
        self.assertIs(type(data["created_ns"]), int)
        self.assertEqual(set(data["files"]), {
            path.relative_to(self.workspace).as_posix() for path in paths
        })
        for path in paths:
            entry = data["files"][path.relative_to(self.workspace).as_posix()]
            self.assertEqual(entry["mtime_ns"], original_times[path])
            self.assertEqual(entry["mode"], 0o644)
            self.assertEqual(entry["size"], len(path.read_bytes()))
            os.utime(path, None)
        self.run_cli("restore")
        for path in paths:
            self.assertEqual(path.stat().st_mtime_ns, original_times[path])
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)

    def test_same_size_and_mode_changed_bytes_are_freshened(self):
        path = self.write("ios/App.swift", b"old")
        self.save()
        self.write("ios/App.swift", b"new", mtime=self.old_ns - SECOND)
        before = time.time_ns()
        self.run_cli("restore")
        self.assert_fresh(path, before)
        self.assertEqual(path.read_bytes(), b"new")
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)

    def test_new_file_with_old_archive_timestamp_invalidates_before_mutation(self):
        existing = self.write("ios/App.swift")
        self.save()
        os.utime(existing, None)
        added = self.write("node_modules/example/new.h", b"new header",
                           mtime=self.old_ns - 86400 * SECOND)
        self.assert_rejected_without_touching([existing, added])
        self.assertEqual(added.read_bytes(), b"new header")

    def test_mode_change_is_preserved_and_freshened(self):
        path = self.write("node_modules/example/build.sh", b"command\n")
        self.save()
        path.chmod(0o755)
        before = time.time_ns()
        self.run_cli("restore")
        self.assert_fresh(path, before)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o755)
        self.assertEqual(path.read_bytes(), b"command\n")

    def test_deleted_input_invalidates_without_recreating_or_touching_files(self):
        retained = self.write("ios/Retained.swift")
        removed = self.write("ios/Removed.swift")
        self.save()
        removed.unlink()
        os.utime(retained, None)
        self.assert_rejected_without_touching([retained])
        self.assertFalse(removed.exists())

    def test_internal_symlink_inventory_is_stable_and_changes_invalidate(self):
        if not hasattr(os, "symlink"):
            self.skipTest("Symbolic links unavailable")
        target = self.write("ios/shared/header.h", b"covered header")
        second_target = self.write("ios/shared/second.h", b"other header")
        existing = self.write("ios/App.swift")
        replaced = self.write("ios/replaced.h")
        (self.workspace / "ios/link.h").symlink_to(target)
        shared = target.parent
        (self.workspace / "ios/vendor").symlink_to(shared, target_is_directory=True)
        (self.workspace / "node_modules").symlink_to(shared, target_is_directory=True)
        # A linked parent of a nested root must be inventoried without traversal.
        (self.workspace / "android").symlink_to(shared, target_is_directory=True)
        nested = self.write("ios/shared/song-fingerprint/lib.rs", b"covered rust")
        data = self.save()
        self.assertEqual(set(data["files"]), {
            "ios/App.swift", "ios/replaced.h", "ios/shared/header.h",
            "ios/shared/second.h", "ios/shared/song-fingerprint/lib.rs",
        })
        links = [self.workspace / "ios/link.h", self.workspace / "ios/vendor",
                 self.workspace / "node_modules", self.workspace / "android"]
        self.assertEqual(data["symlinks"], {
            path.relative_to(self.workspace).as_posix(): os.readlink(path)
            for path in links
        })
        link_times = {path: path.lstat().st_mtime_ns for path in links}
        os.utime(existing, None)
        self.run_cli("restore")
        self.assertEqual(existing.stat().st_mtime_ns, self.old_ns)
        for path in (target, nested):
            self.assertEqual(path.stat().st_mtime_ns, self.old_ns)
        self.assertEqual({path: path.lstat().st_mtime_ns for path in links}, link_times)
        link = self.workspace / "ios/link.h"
        added = self.workspace / "ios/new-link.h"
        for change in ("added", "removed", "repointed", "file-to-link", "link-to-file"):
            with self.subTest(change=change):
                os.utime(existing, None)
                if change == "added":
                    added.symlink_to(target)
                elif change == "file-to-link":
                    replaced.unlink()
                    replaced.symlink_to(target)
                else:
                    link.unlink()
                    if change == "repointed":
                        link.symlink_to(second_target)
                    elif change == "link-to-file":
                        self.write("ios/link.h", b"local replacement")
                self.assert_rejected_without_touching(
                    [existing, target, nested, second_target])
                if change == "added":
                    added.unlink()
                elif change == "file-to-link":
                    replaced.unlink()
                    self.write("ios/replaced.h")
                else:
                    if link.exists() or link.is_symlink():
                        link.unlink()
                    link.symlink_to(target)

    def test_external_untracked_dangling_and_looped_links_reject_without_writes(self):
        if not hasattr(os, "symlink"):
            self.skipTest("Symbolic links unavailable")
        existing = self.write("ios/App.swift")
        original = self.save()
        outside = self.base / "external"
        outside.mkdir()
        target = outside / "header.h"
        target.write_bytes(b"external header")
        os.utime(target, ns=(self.old_ns, self.old_ns))
        nested = outside / "song-fingerprint"
        nested.mkdir()
        external_rust = nested / "lib.rs"
        external_rust.write_bytes(b"external rust")
        os.utime(external_rust, ns=(self.old_ns, self.old_ns))
        skipped = self.write("ios/target/library.h", b"uncached binary")
        cases = [
            ("ios/link.h", target, False),
            ("ios/vendor", outside, True),
            ("node_modules", outside, True),
            ("android", outside, True),
            ("ios/link.h", skipped, False),
            ("ios/link.h", self.workspace / "ios/missing.h", False),
            ("ios/link.h", "link.h", False),
        ]
        for relative, destination, directory in cases:
            with self.subTest(path=relative, destination=str(destination)):
                link = self.workspace / relative
                link.symlink_to(destination, target_is_directory=directory)
                os.utime(existing, None)
                self.write_manifest(original)
                manifest_before = self.manifest.read_bytes()
                times = {path: path.stat().st_mtime_ns
                         for path in (existing, target, external_rust, skipped)}
                self.run_cli("save", succeeds=False)
                self.assertEqual(self.manifest.read_bytes(), manifest_before)
                self.assertEqual({path: path.stat().st_mtime_ns for path in times}, times)
                # Even a hand-crafted matching inventory must not make an
                # external or untracked target eligible for warm-cache reuse.
                forged = copy.deepcopy(original)
                forged["symlinks"][relative] = os.readlink(link)
                self.write_manifest(forged)
                self.assert_rejected_without_touching(
                    [existing, target, external_rust, skipped])
                link.unlink()
        self.write_manifest(original)
        alias = self.base / "manifest-link.json"
        alias.symlink_to(self.manifest)
        self.assert_rejected_without_touching([existing, target], manifest=alias)

    def test_unscanned_roots_and_cache_directories_are_untouched(self):
        self.write("ios/App.swift")
        excluded = [
            self.write("android/song-fingerprint/target/release/library.a"),
            self.write("node_modules/example/.git/config"),
            self.write("ios/__pycache__/helper.pyc"),
            self.write("src/app.ts"),
        ]
        data = self.save()
        self.assertEqual(set(data["files"]), {"ios/App.swift"})
        for path in excluded:
            path.write_bytes(b"changed but outside cache inputs")
            os.utime(path, ns=(self.old_ns, self.old_ns))
        self.run_cli("restore")
        for path in excluded:
            self.assertEqual(path.stat().st_mtime_ns, self.old_ns)

    def test_missing_or_wrong_workspace_manifest_fails_before_touching_inputs(self):
        existing = self.write("ios/App.swift")
        self.assert_rejected_without_touching([existing])
        data = self.save()
        os.utime(existing, None)
        data["workspace"] = str(self.base / "another-checkout")
        self.write_manifest(data)
        self.assert_rejected_without_touching([existing])

    def test_malformed_manifest_is_fully_validated_before_mutation(self):
        original, paths = self.invalid_fixture()
        cases = []
        for version in (None, 0, 2, "1", True):
            data = copy.deepcopy(original)
            data["version"] = version
            cases.append((f"version {version!r}", data))
        for files in (None, [], {}, "invalid"):
            data = copy.deepcopy(original)
            data["files"] = files
            cases.append((f"files {files!r}", data))
        for field, value in (("sha256", "not a digest"), ("size", -1),
                             ("size", True), ("mode", 0o10000),
                             ("mode", "644"), ("mtime_ns", -1),
                             ("mtime_ns", 1.5)):
            data = copy.deepcopy(original)
            data["files"]["node_modules/example/late.h"][field] = value
            cases.append((f"entry {field}={value!r}", data))
        data = copy.deepcopy(original)
        data["files"]["node_modules/example/late.h"] = {"sha256": "a" * 64}
        cases.append(("missing entry metadata", data))
        for links in (None, [], {"../outside": "target"}, {"ios/link.h": None}):
            data = copy.deepcopy(original)
            data["symlinks"] = links
            cases.append((f"symlinks {links!r}", data))
        for label, data in cases:
            with self.subTest(label=label):
                self.write_manifest(data)
                self.assert_rejected_without_touching(paths)
        self.manifest.write_text('{"version":')
        self.assert_rejected_without_touching(paths)

    def test_traversal_absolute_and_unscanned_paths_are_rejected_atomically(self):
        original, paths = self.invalid_fixture()
        outside = self.base / "outside.swift"
        outside.write_bytes(b"do not touch")
        os.utime(outside, ns=(self.old_ns, self.old_ns))
        for relative in ("../outside.swift", str(outside), "ios/../../outside.swift",
                         "ios/../App.swift", "ios//App.swift", "ios/./App.swift",
                         "ios\\App.swift", "src/app.ts", "ios/target/input.h"):
            with self.subTest(path=relative):
                data = copy.deepcopy(original)
                data["files"][relative] = copy.deepcopy(next(iter(data["files"].values())))
                self.write_manifest(data)
                self.assert_rejected_without_touching(paths + [outside])

    def test_future_manifest_and_input_times_are_rejected_atomically(self):
        original, paths = self.invalid_fixture()
        future = time.time_ns() + 86400 * SECOND
        for field in ("created_ns", "mtime_ns", "after_creation"):
            with self.subTest(field=field):
                data = copy.deepcopy(original)
                if field == "created_ns":
                    data["created_ns"] = future
                else:
                    entry = data["files"]["node_modules/example/late.h"]
                    entry["mtime_ns"] = (data["created_ns"] + 1
                                         if field == "after_creation" else future)
                self.write_manifest(data)
                self.assert_rejected_without_touching(paths)

if __name__ == "__main__":
    unittest.main(verbosity=2)
