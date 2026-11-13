"""Actual audio inference. All timestamps refer to the untrimmed original audio."""

import importlib.util
import hashlib
from functools import lru_cache
import json
import logging
import math
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import time
import wave

from .config import Settings, MODEL_REVISIONS
from .singing import ADAPTER_VERSION, adapt_segment, capture_native_alignment


class AnalysisError(Exception):
    pass


CHORD_HASHES = [
    "921b42d5d1cf9ce1c0c0e45a74d409b8066e0acec46058ef74e24ee0fb540761",
    "bcb75859e0efa256696cf5da396b320093317b9b1d9560c304f46c25fe1f8b17",
    "acddf85c3fff29954c4877021177d72e2cba9f729ce80c1010f054c477bf3f61",
    "65d81a3ab73435aaaade586981b4cabdf57b8953d76052703e6968c32ef8421c",
    "5ff6b0ec85640e17a09a9b3de68c93fdd45adc24488e8fa9be5715c28d561122",
]


def chord_weights_present(verify_hashes=False):
    if importlib.util.find_spec("lv_chordia") is None:
        return False
    # Pinned wheel asset location. Missing weights must never fall through to random networks.
    directory = Path(sys.prefix) / "share" / "lv-chordia" / "cache_data"
    for index, expected in enumerate(CHORD_HASHES):
        path = directory / f"joint_chord_net_ismir_naive_v1.0_reweight(0.0,10.0)_s{index}.best.sdict"
        if not path.is_file():
            return False
        if verify_hashes:
            with path.open("rb") as handle:
                if hashlib.file_digest(handle, "sha256").hexdigest() != expected:
                    return False
    return True


@lru_cache(maxsize=8)
def _verify_model_snapshot(path, identity, revision, signature):
    directory = Path(path)
    try:
        manifest = json.loads((directory / "freetune-model.json").read_text("utf-8"))
        if manifest["id"] != identity or manifest["revision"] != revision:
            return False
        for name in ("model.bin", "config.json", "tokenizer.json"):
            with (directory / name).open("rb") as handle:
                if hashlib.file_digest(handle, "sha256").hexdigest() != manifest["sha256"][name]:
                    return False
        return True
    except (OSError, ValueError, KeyError):
        return False


def whisper_weights_present(settings):
    required = [settings.model_path / name for name in
                ("model.bin", "config.json", "tokenizer.json", "freetune-model.json")]
    try:
        signature = tuple((path.stat().st_size, path.stat().st_mtime_ns) for path in required)
    except OSError:
        return False
    return _verify_model_snapshot(str(settings.model_path), *MODEL_REVISIONS[settings.whisper_model], signature)


def availability(settings: Settings):
    whisper = whisper_weights_present(settings)
    whisper = whisper and importlib.util.find_spec("faster_whisper") is not None
    chords = chord_weights_present(verify_hashes=True)
    ffmpeg = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
    return {"ready": bool(whisper and chords and ffmpeg), "models": {
        "lyrics": {"name": MODEL_REVISIONS[settings.whisper_model][0], "ready": whisper},
        "chords": {"name": "lv-chordia-1.1.0", "ready": chords},
        "decoder": {"name": "ffmpeg", "ready": ffmpeg},
    }}


def decode_audio(source: Path, target: Path, settings: Settings):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise AnalysisError("decoder_not_installed")
    try:
        probe = subprocess.run([
            "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe",
            "-format_whitelist", "mp3,wav,mov", "-show_entries", "format=duration:stream=codec_type,duration",
            "-of", "json", str(source),
        ], capture_output=True, timeout=30, check=True)
        metadata = json.loads(probe.stdout)
        streams = [s for s in metadata.get("streams", []) if s.get("codec_type") == "audio"]
        if not streams:
            raise AnalysisError("no_audio_stream")
        raw_duration = metadata.get("format", {}).get("duration") or streams[0].get("duration")
        duration = float(raw_duration) if raw_duration is not None else 0
        if not math.isfinite(duration) or duration <= 0:
            raise AnalysisError("invalid_audio_duration")
        if duration > settings.max_duration_seconds:
            raise AnalysisError("audio_too_long")
        # Reserve against the decode cap too: container duration metadata can be wrong.
        needed = int((settings.max_duration_seconds + 1) * 22050 * 2) + 32 * 1024 * 1024
        if shutil.disk_usage(target.parent).free < needed:
            raise AnalysisError("insufficient_disk_space")
        subprocess.run([
            "ffmpeg", "-nostdin", "-hide_banner", "-v", "error", "-xerror", "-y",
            "-protocol_whitelist", "file,pipe", "-format_whitelist", "mp3,wav,mov", "-i", str(source),
            "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "22050", "-c:a", "pcm_s16le",
            "-t", str(settings.max_duration_seconds + 1), str(target),
        ], capture_output=True, timeout=180, check=True)
        with wave.open(str(target), "rb") as audio:
            decoded_duration = audio.getnframes() / audio.getframerate()
        if decoded_duration > settings.max_duration_seconds:
            raise AnalysisError("audio_too_long")
        if decoded_duration <= 0:
            raise AnalysisError("empty_audio")
        # No silence removal, time stretch, or concatenation: decoded frame zero is playback zero.
        return decoded_duration
    except AnalysisError:
        raise
    except (ValueError, KeyError, json.JSONDecodeError, wave.Error, subprocess.CalledProcessError):
        raise AnalysisError("invalid_audio") from None
    except subprocess.TimeoutExpired:
        raise AnalysisError("decode_timeout") from None


CHORD_QUALITIES = {
    "maj": "", "min": "m", "7": "7", "maj7": "maj7", "min7": "m7", "dim": "dim",
    "dim7": "dim7", "hdim7": "m7b5", "aug": "aug", "sus2": "sus2", "sus4": "sus4",
    "maj6": "6", "min6": "m6", "9": "9", "maj9": "maj9", "min9": "m9",
    "minmaj7": "mMaj7", "11": "11", "13": "13", "5": "5",
}
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
ROOTS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
DEGREES = {"1": 0, "2": 2, "3": 4, "4": 5, "5": 7, "6": 9, "7": 11}


def chord_label(harte: str):
    """Convert recognized harmony, never silently substitute a simpler fingering."""
    if harte in {"N", "X", "?"}:
        return "N" if harte == "N" else "?"
    match = re.fullmatch(r"([A-G])([b#]?)(?::([^/]+))?(?:/([b#]?\d|[A-G][b#]?))?", harte)
    if not match:
        return harte
    note, accidental, quality, bass = match.groups()
    if (quality or "maj") not in CHORD_QUALITIES:
        return harte
    label = note + accidental + CHORD_QUALITIES[quality or "maj"]
    if bass:
        if bass[0] in ROOTS:
            bass_note = bass
        else:
            degree = bass.lstrip("b#")
            if degree not in DEGREES:
                return harte
            root = ROOTS[note] + (1 if accidental == "#" else -1 if accidental == "b" else 0)
            step = DEGREES[degree] + (1 if bass.startswith("#") else -1 if bass.startswith("b") else 0)
            bass_note = NOTE_NAMES[(root + step) % 12]
        label += "/" + bass_note
    return label


def chord_intervals(annotations, duration):
    """Bound recognized intervals to the untrimmed recording, preserving labels."""
    result = []
    for item in annotations:
        start, end = float(item["start_time"]), float(item["end_time"])
        if not math.isfinite(start) or not math.isfinite(end):
            continue
        start, end = max(0, start), min(duration, end)
        if end <= start:
            continue
        label = chord_label(str(item["chord"]))
        result.append({"start": start, "end": end, "label": label, "uncertain": label == "?"})
    return result


def recognize_chords(audio: Path, duration: float, settings: Settings, observer=None):
    if not chord_weights_present(verify_hashes=True):
        raise AnalysisError("chord_model_not_installed")
    import torch
    torch.set_num_threads(settings.cpu_threads)
    from .chords import recognize_harmony
    # The public endpoint only supplies an owned local WAV, never a remote URL.
    annotations = recognize_harmony(audio, observer=observer)
    result = chord_intervals(annotations, duration)
    if not result:
        raise AnalysisError("no_chords_detected")
    return result


def disjoint_lyrics(lines):
    """Preserve text and honest coarse intervals if a model returns overlapping words."""
    result, unreliable = [], False
    for line in sorted(lines, key=lambda item: item["start"]):
        words = line["words"]
        if any(b["start"] < a["end"] for a, b in zip(words, words[1:])):
            line = {**line, "words": [], "uncertain": True}
            unreliable = True
        if result and line["start"] < result[-1]["end"]:
            previous = result[-1]
            result[-1] = {"start": previous["start"], "end": max(previous["end"], line["end"]),
                          "text": previous["text"] + " " + line["text"], "words": [], "uncertain": True}
            unreliable = True
        else:
            result.append(line)
    return result, unreliable


NON_LYRIC_CAPTIONS = {
    "MUSIC", "INSTRUMENTAL", "INSTRUMENTAL MUSIC", "SOFT MUSIC", "CALM MUSIC",
    "МУЗЫКА", "СПОКОЙНАЯ МУЗЫКА", "СПОКОЙНАЯ МЕЛОДИЯ", "ИНСТРУМЕНТАЛЬНАЯ МУЗЫКА",
    "МУЗИКА", "СПОКІЙНА МУЗИКА", "СПОКІЙНА МЕЛОДІЯ", "ІНСТРУМЕНТАЛЬНА МУЗИКА",
}


def remove_non_lyric_captions(lines):
    """Omit recognizable ASR subtitle labels, not lyrics containing 'music'.

    This is a conservative formatting rule, not a vocal/instrumental classifier.
    It operates on the final line structure so saved evaluations can be audited.
    """
    kept = []
    for line in lines:
        text = line["text"].strip()
        label = " ".join(re.sub(r"[\[\]()♪♫]", " ", text).split())
        wrapped = bool(re.fullmatch(r"\[[\s\S]*\]|\([\s\S]*\)|[♪♫][\s\S]*[♪♫]", text))
        musical_marks_only = bool(text) and not label and any(mark in text for mark in "♪♫")
        caption = label.upper() in NON_LYRIC_CAPTIONS and (wrapped or label.isupper())
        if not caption and not musical_marks_only:
            kept.append(line)
    return kept, len(lines) - len(kept)


def recognize_lyrics(audio: Path, duration: float, language: str, settings: Settings, progress,
                     native_observer=None):
    if not availability(settings)["models"]["lyrics"]["ready"]:
        raise AnalysisError("lyrics_model_not_installed")
    from faster_whisper import WhisperModel
    import ctranslate2
    # Fix fallback sampling for reproducible evaluations and retries. This is
    # process-local; each worker has its own model and random generator.
    ctranslate2.set_random_seed(0)
    model = WhisperModel(
        str(settings.model_path), device=settings.device, compute_type=settings.compute_type,
        cpu_threads=settings.cpu_threads, num_workers=1, local_files_only=True,
    )
    native_evidence = capture_native_alignment(model)
    # Already-decoded PCM avoids a second container decode and any differing codec priming.
    import soundfile as sf
    from scipy.signal import resample_poly
    samples, rate = sf.read(str(audio), dtype="float32", always_2d=True)
    samples = samples.mean(axis=1)
    if rate != 16000:
        divisor = math.gcd(rate, 16000)
        samples = resample_poly(samples, 16000 // divisor, rate // divisor)
    segments, info = model.transcribe(
        samples, language=None if language == "auto" else language, task="transcribe",
        word_timestamps=True, condition_on_previous_text=False, beam_size=5,
        vad_filter=False, no_speech_threshold=0.6, log_prob_threshold=-1.0,
        compression_ratio_threshold=2.4, hallucination_silence_threshold=2.0,
    )
    detected = info.language if info.language in {"uk", "ru", "en"} else None
    lines, warnings = [], []
    for segment in segments:
        progress(min(0.98, 0.45 + 0.53 * max(0, segment.end) / duration), lines, detected, warnings)
        evidence = native_evidence(segment)
        if native_observer:
            native_observer(segment, evidence)
        line, segment_warnings = adapt_segment(segment, duration, evidence)
        warnings.extend(segment_warnings)
        if line:
            lines.append(line)
    lines, unreliable = disjoint_lyrics(lines)
    lines, omitted = remove_non_lyric_captions(lines)
    if omitted:
        warnings.append("non_lyric_caption_omitted")
    if unreliable:
        warnings.append("word_timing_unreliable")
    if not lines:
        warnings.append("no_lyrics")
    if detected is None:
        warnings.append("language_not_supported")
    return lines, detected, sorted(set(warnings))


def analyze(source: Path, directory: Path, language: str, settings: Settings, emit):
    started = time.monotonic()
    import psutil
    process = psutil.Process()
    peak = process.memory_info().rss
    result = {
        "version": 1, "duration": 0, "language": None if language == "auto" else language,
        "lyrics": [], "chords": [], "warnings": [],
        "model": {"lyrics": MODEL_REVISIONS[settings.whisper_model][0],
                  "alignment": f"Whisper cross-attention DTW; {ADAPTER_VERSION} (native evidence, no invented timing)",
                  "chords": "lv-chordia-1.1.0 (5-model CQT ensemble + equal initial HMM priors)"},
    }

    def report(stage, progress, status="running", error=None):
        nonlocal peak
        peak = max(peak, process.memory_info().rss)
        if os.name == "posix":
            import resource
            high_water = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            peak = max(peak, high_water if platform.system() == "Darwin" else high_water * 1024)
        result["metrics"] = {"elapsedSeconds": round(time.monotonic() - started, 3),
                             "peakRssMb": round(peak / 1024**2, 2),
                             "device": f"{settings.device}/{platform.system()}/{platform.machine()}"}
        emit({"status": status, "stage": stage, "progress": progress, "error": error,
              "result": result if result["duration"] > 0 else None})

    report("decoding", 0.02)
    decoded = directory / "decoded.wav"
    try:
        result["duration"] = decode_audio(source, decoded, settings)
        failed = []
        report("chords", 0.08)
        try:
            result["chords"] = recognize_chords(decoded, result["duration"], settings)
        except Exception as exc:
            logging.exception("Chord inference failed")
            code = str(exc) if isinstance(exc, AnalysisError) else "chords_failed"
            result["warnings"].append(code)
            failed.append("chords")
        report("lyrics", 0.45)
        def lyric_progress(value, lines, detected, warnings):
            partial, unreliable = disjoint_lyrics(lines)
            partial, omitted = remove_non_lyric_captions(partial)
            result.update(lyrics=partial, language=detected)
            result["warnings"] = sorted(set(result["warnings"] + warnings +
                                            (["word_timing_unreliable"] if unreliable else []) +
                                            (["non_lyric_caption_omitted"] if omitted else [])))
            report("lyrics", value)
        try:
            lyrics, detected, warnings = recognize_lyrics(
                decoded, result["duration"], language, settings, lyric_progress)
            result.update(lyrics=lyrics, language=detected)
            result["warnings"].extend(warnings)
        except Exception as exc:
            logging.exception("Lyric inference failed")
            code = str(exc) if isinstance(exc, AnalysisError) else "lyrics_failed"
            result["warnings"].append(code)
            failed.append("lyrics")
        result["warnings"] = sorted(set(result["warnings"]))
        useful = bool(result["chords"] or result["lyrics"])
        status = "failed" if len(failed) == 2 and not useful else "partial" if failed else "completed"
        report("done", 1.0, status, "analysis_failed" if len(failed) == 2 else None)
    except AnalysisError as exc:
        report("failed", 0, "failed", str(exc))
    finally:
        decoded.unlink(missing_ok=True)
    return result
