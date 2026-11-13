#!/usr/bin/env python3
"""Prove same-native legacy replay equals the original repository adapter.

This does not run another neural inference or measure legacy model resources.
It executes the original recognizer's adapter loop on captured native segments,
with model/PCM reads replaced by explicitly synthetic replay inputs. No human
reference text or timing is used in this equivalence check.
"""

import argparse
import ast
import json
import math
from pathlib import Path
import re
import subprocess
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--ids", nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--commit", default="3a73101fb22483b405e61f1c3ce340709f8cc1da")
    args = parser.parse_args()
    if not re.fullmatch("[0-9a-f]{40}", args.commit):
        parser.error("--commit requires an immutable full commit ID")
    source = subprocess.check_output(
        ["git", "show", args.commit + ":backend/freetune_analysis/pipeline.py"], cwd=ROOT, text=True)
    tree = ast.parse(source)
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "recognize_lyrics")
    from freetune_analysis import pipeline
    from freetune_analysis.config import Settings
    environment = {"Path": Path, "Settings": Settings, "math": math,
                   "AnalysisError": pipeline.AnalysisError,
                   "availability": lambda _: {"models": {"lyrics": {"ready": True}}},
                   "disjoint_lyrics": pipeline.disjoint_lyrics,
                   "remove_non_lyric_captions": pipeline.remove_non_lyric_captions}
    exec(compile(ast.Module(body=[function], type_ignores=[]), "original_recognize_lyrics", "exec"), environment)
    original = environment["recognize_lyrics"]
    import faster_whisper
    import numpy as np
    import soundfile
    real_model, real_read = faster_whisper.WhisperModel, soundfile.read
    checks = []
    try:
        for identity in args.ids:
            folder = args.results / "results" / identity
            native = json.loads((folder / "native.json").read_text("utf-8"))["segments"]
            saved = json.loads((folder / "legacy-result.json").read_text("utf-8"))
            segments = []
            for item in native:
                segment = item["segment"]
                segments.append(SimpleNamespace(**{**segment, "words": [SimpleNamespace(**word) for word in segment["words"] or []]}))
            class ReplayModel:
                def __init__(self, *arguments, **keywords):
                    pass

                def transcribe(self, *arguments, **keywords):
                    return iter(segments), SimpleNamespace(language=saved["language"])
            faster_whisper.WhisperModel = ReplayModel
            soundfile.read = lambda *arguments, **keywords: (np.zeros((160, 1), dtype="float32"), 16000)
            lines, language, warnings = original(Path("synthetic-replay.wav"), saved["duration"],
                                                 saved["language"] or "auto", Settings(data_dir=folder), lambda *values: None)
            expected_warnings = sorted(code for code in saved["warnings"] if code in
                                       {"lyrics_unreliable", "word_timing_unreliable", "no_lyrics",
                                        "non_lyric_caption_omitted", "language_not_supported"})
            checks.append({"id": identity, "nativeSegments": len(segments),
                           "lyricsTextTimesAndConfidenceExactlyEqual": lines == saved["lyrics"],
                           "languageExactlyEqual": language == saved["language"],
                           "warningsExactlyEqual": warnings == expected_warnings})
    finally:
        faster_whisper.WhisperModel, soundfile.read = real_model, real_read
    passed = all(all(check[key] for key in ("lyricsTextTimesAndConfidenceExactlyEqual", "languageExactlyEqual", "warningsExactlyEqual")) for check in checks)
    report = {"schemaVersion": 3, "legacySourceCommit": args.commit,
              "method": "Execute original adapter function on captured identical native segments; synthetic PCM/model replay, not separate inference",
              "referenceSupplied": False, "separateInferenceRuntimeMeasured": False,
              "checks": checks, "passed": passed}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", "utf-8")
    print(json.dumps(report, indent=2), flush=True)
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
