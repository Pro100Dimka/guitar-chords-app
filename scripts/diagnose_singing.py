#!/usr/bin/env python3
"""Capture actual Whisper native/adjusted evidence without reference text.

This explicit evaluation utility never runs in the HTTP service. It preserves
the decoded full timeline and captures DTW values before faster-whisper's
duration heuristics. Run one process per model/thread/audio configuration.
"""

import argparse
from copy import deepcopy
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import platform
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", choices=("small", "turbo"), required=True)
    parser.add_argument("--threads", type=int, choices=(2, 4), required=True)
    parser.add_argument("--language", choices=("en", "uk", "ru", "auto"), default="en")
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.output.exists():
        raise SystemExit("Refusing to overwrite existing diagnostic: " + str(args.output))
    os.environ.update(OMP_NUM_THREADS=str(args.threads), MKL_NUM_THREADS=str(args.threads),
                      HF_HUB_OFFLINE="1")
    import ctranslate2
    from faster_whisper import WhisperModel
    import faster_whisper
    from freetune_analysis.config import Settings, MODEL_REVISIONS
    from freetune_analysis.pipeline import ADAPTER_VERSION, decode_audio, recognize_lyrics
    ctranslate2.set_random_seed(0)
    observations = []
    native_segments = []
    generations = []

    class ObservedWhisper(WhisperModel):
        def generate_with_fallback(self, encoder_output, prompt, tokenizer, options):
            result, average, temperature, compression = super().generate_with_fallback(
                encoder_output, prompt, tokenizer, options)
            generations.append({"text": tokenizer.decode(result.sequences_ids[0]),
                                "avg_logprob": average, "temperature": temperature,
                                "compression_ratio": compression,
                                "no_speech_prob": result.no_speech_prob})
            return result, average, temperature, compression

        def find_alignment(self, *arguments, **keywords):
            aligned = super().find_alignment(*arguments, **keywords)
            observations[-1]["rawDtwAlignments"] = deepcopy(aligned)
            return aligned

        def add_word_timestamps(self, segments, *arguments, **keywords):
            observation = {"beforeAlignment": deepcopy(segments)}
            observations.append(observation)
            result = super().add_word_timestamps(segments, *arguments, **keywords)
            observation["afterAlignment"] = deepcopy(segments)
            return result

        def transcribe(self, *arguments, **keywords):
            segments, info = super().transcribe(*arguments, **keywords)
            def capture():
                for segment in segments:
                    native_segments.append(asdict(segment))
                    yield segment
            return capture(), info

    faster_whisper.WhisperModel = ObservedWhisper
    settings = Settings(data_dir=ROOT / "backend/data", whisper_model=args.model,
                        cpu_threads=args.threads)
    decoded = args.output.with_suffix(".decoded.wav")
    started = time.monotonic()
    try:
        duration = decode_audio(args.audio.resolve(), decoded, settings)
        lines, language, warnings = recognize_lyrics(
            decoded, duration, args.language, settings, lambda *values: None)
    finally:
        decoded.unlink(missing_ok=True)
    with args.audio.open("rb") as handle:
        sha = hashlib.file_digest(handle, "sha256").hexdigest()
    report = {
        "schemaVersion": 1, "purpose": "Native singing/instrumental diagnosis; not accuracy evaluation",
        "audio": str(args.audio.resolve()), "audioSha256": sha, "duration": duration,
        "model": dict(zip(("id", "revision"), MODEL_REVISIONS[args.model])),
        "threads": args.threads, "seed": 0, "device": "cpu/int8", "platform": platform.platform(),
        "wallSeconds": time.monotonic() - started, "referenceSuppliedToInference": False,
        "segments": native_segments, "alignmentCalls": observations, "generationCalls": generations,
        "adapterOutput": {"version": ADAPTER_VERSION, "lyrics": lines, "language": language, "warnings": warnings},
    }
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2,
                                      default=lambda value: value.item()) + "\n", "utf-8")
    print(json.dumps({"output": str(args.output), "model": args.model, "threads": args.threads,
                      "nativeSegments": len(native_segments), "lyricLines": len(lines),
                      "wallSeconds": report["wallSeconds"]}), flush=True)


if __name__ == "__main__":
    main()
