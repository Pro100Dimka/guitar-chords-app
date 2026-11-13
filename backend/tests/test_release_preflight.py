"""Offline unit checks for the developer's release endpoint preflight.

The checks must never connect to a public host or start paid resources.
"""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


MODULE = Path(__file__).resolve().parents[1] / "deploy" / "release_preflight.py"
spec = importlib.util.spec_from_file_location("freetune_release_preflight", MODULE)
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class ReleasePreflightTest(unittest.TestCase):
    def test_accepts_public_https_origin(self):
        self.assertEqual(
            preflight.validate_public_url("https://analysis.example.org/"),
            "https://analysis.example.org",
        )

    def test_rejects_non_public_and_credential_origins(self):
        invalid = [
            "", "http://analysis.example.org", "https://localhost",
            "https://127.0.0.1", "https://10.0.0.8",
            "https://192.168.1.5", "https://169.254.1.1",
            "https://[::1]", "https://analysis.local",
            "https://analysis.internal", "https://user:secret@analysis.example.org",
            "https://analysis.example.org/path", "https://analysis.example.org/?a=1",
            "https://analysis.example.org/#fragment",
        ]
        for url in invalid:
            with self.subTest(url=url), self.assertRaises(ValueError):
                preflight.validate_public_url(url)

    def test_rejects_unready_and_private_mode(self):
        for health in [
            {"ready": False, "serviceMode": "shared", "authentication": "installation"},
            {"ready": True, "serviceMode": "private", "authentication": "installation"},
            {"ready": True, "serviceMode": "shared", "authentication": "none"},
        ]:
            with self.subTest(health=health):
                with patch.object(preflight, "check_health", return_value=health):
                    self.assertEqual(preflight.main(["https://analysis.example.org"]), 1)

    def test_success_is_read_only(self):
        health = {"ready": True, "serviceMode": "shared", "authentication": "installation"}
        with patch.object(preflight, "check_health", return_value=health) as check:
            self.assertEqual(preflight.main(["https://analysis.example.org"]), 0)
            check.assert_called_once_with("https://analysis.example.org", 15)


if __name__ == "__main__":
    unittest.main()
