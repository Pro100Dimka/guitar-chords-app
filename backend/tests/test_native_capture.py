from copy import deepcopy
from types import MethodType, SimpleNamespace

from faster_whisper import WhisperModel

from freetune_analysis.singing import capture_native_alignment


def fake_model():
    model = SimpleNamespace(frames_per_second=100)
    raw = [[{"word": " sing", "tokens": [10], "start": 0.0, "end": 3.0, "probability": 0.9},
            {"word": " on", "tokens": [11], "start": 3.0, "end": 3.3, "probability": 0.95},
            {"word": ".", "tokens": [12], "start": 3.3, "end": 3.32, "probability": 0.8}]]
    model.find_alignment = lambda *args, **kwargs: deepcopy(raw)
    model.add_word_timestamps = MethodType(WhisperModel.add_word_timestamps, model)
    return model


def test_capture_keeps_sdk_decoder_alignment_unchanged_and_retains_native_spans():
    source = [[{"seek": 1000, "start": 10.0, "end": 39.98,
                "tokens": [50365, 10, 11, 12, 51864]}]]
    before, after = deepcopy(source), deepcopy(source)
    control, observed = fake_model(), fake_model()
    native_for = capture_native_alignment(observed)
    arguments = (SimpleNamespace(eot=50257), None, 3000, "\"'", ".,!?", 0.0)
    old_last = control.add_word_timestamps(before, *arguments)
    new_last = observed.add_word_timestamps(after, *arguments)
    assert old_last == new_last and before == after
    final = after[0][0]
    native = native_for(SimpleNamespace(**final))
    assert native == [{"word": " sing", "start": 10.0, "end": 13.0},
                      {"word": " on.", "start": 13.0, "end": 13.3}]
    assert final["words"][0]["start"] > native[0]["start"]


def test_missing_native_api_does_not_invent_alignment_evidence():
    native_for = capture_native_alignment(SimpleNamespace())
    assert native_for(SimpleNamespace(start=0, end=10)) == []
