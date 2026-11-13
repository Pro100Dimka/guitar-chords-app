from copy import deepcopy
import sys
from types import SimpleNamespace
import wave

from freetune_analysis.config import Settings
from freetune_analysis import pipeline


def test_progress_does_not_refilter_a_caption_token_after_supported_span_split(tmp_path, monkeypatch):
    lines = [{"start": 0, "end": 1, "text": "[MUSIC]", "words": [
        {"start": 0, "end": 1, "text": "[MUSIC]", "confidence": 0.9, "uncertain": False}], "uncertain": False},
        {"start": 1, "end": 6, "text": "X lyrics", "words": [], "uncertain": True}]
    monkeypatch.setattr(pipeline, "decode_audio", lambda *args: 10)
    monkeypatch.setattr(pipeline, "recognize_chords", lambda *args: [])
    def lyrics(audio, duration, language, settings, progress):
        progress(0.9, lines, "en", ["word_timing_unreliable"])
        return lines, "en", ["word_timing_unreliable"]
    monkeypatch.setattr(pipeline, "recognize_lyrics", lyrics)
    states = []
    pipeline.analyze(tmp_path / "input.wav", tmp_path, "en", Settings(data_dir=tmp_path),
                     lambda state: states.append(deepcopy(state)))
    partial = next(state for state in states if state["progress"] == 0.9)
    assert partial["result"]["lyrics"] == lines


def test_empty_prefix_does_not_persist_a_false_no_lyrics_warning(tmp_path, monkeypatch):
    source = tmp_path / "audio.wav"
    with wave.open(str(source), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(b"\0\0" * 16000)
    def segment(text, start, end):
        return SimpleNamespace(start=start, end=end, avg_logprob=-0.2, no_speech_prob=0.1,
                               compression_ratio=1.1, words=[SimpleNamespace(
                                   word=text, start=start, end=end, probability=0.9)])
    class Recognizer:
        def __init__(self, *args, **kwargs):
            pass

        def transcribe(self, *args, **kwargs):
            return iter([segment("[MUSIC]", 0, 0.3), segment("sing", 0.4, 0.8)]), SimpleNamespace(language="en")
    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=Recognizer))
    monkeypatch.setattr(pipeline, "availability", lambda _: {"models": {"lyrics": {"ready": True}}})
    monkeypatch.setattr(pipeline, "capture_native_alignment", lambda _: lambda item: [
        {"word": word.word, "start": word.start, "end": word.end} for word in item.words])
    progress = []
    lines, _, warnings = pipeline.recognize_lyrics(source, 1, "en", Settings(data_dir=tmp_path),
                                                 lambda value, lines, lang, warnings: progress.append(list(warnings)))
    assert lines[0]["text"] == "sing"
    assert "no_lyrics" not in warnings and all("no_lyrics" not in value for value in progress)
