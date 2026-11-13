from types import SimpleNamespace

import pytest

from freetune_analysis.singing import adapt_segment, native_supports


def segment(*, average=-1.2, compression=1.2, start=4.2, end=4.7, probability=0.9, text="sing"):
    return SimpleNamespace(avg_logprob=average, compression_ratio=compression, no_speech_prob=0.1,
                           words=[SimpleNamespace(start=start, end=end, probability=probability, word=text)])


def test_nonrepetitive_weak_window_retains_strong_word_only_with_native_support():
    item = segment()
    evidence = [{"start": 4.1, "end": 4.7, "word": "sing"}]
    old, _ = adapt_segment(item, 30, evidence, legacy=True)
    new, warnings = adapt_segment(item, 30, evidence)
    assert old["text"] == "…" and new["text"] == "sing"
    assert new["words"][0]["start"] == 4.2 and new["words"][0]["end"] == 4.7
    assert new["uncertain"] and "lyrics_unreliable" in warnings


@pytest.mark.parametrize("evidence", [None, [], [{"start": 4.7, "end": 4.7, "word": "sing"}],
                                     [{"start": 4.1, "end": 4.7, "word": "other"}],
                                     [{"start": 4.3, "end": 4.4, "word": "sing"}],
                                     [{"start": float("nan"), "end": 4.7, "word": "sing"}]])
def test_missing_or_invalid_native_alignment_cannot_recover_text(evidence):
    line, _ = adapt_segment(segment(), 30, evidence)
    assert line is None or line["text"] == "…"


def test_repetition_masks_even_extremely_confident_tokens_with_valid_native_spans():
    line, warnings = adapt_segment(segment(compression=5.0, probability=0.999), 30,
                                   [{"start": 4.1, "end": 4.7, "word": "sing"}])
    assert line["text"] == "…" and line["uncertain"] and "lyrics_unreliable" in warnings


def test_moderate_word_probability_in_weak_window_remains_masked():
    line, _ = adapt_segment(segment(probability=0.69), 30,
                            [{"start": 4.1, "end": 4.7, "word": "sing"}])
    assert line["text"] == "…"


@pytest.mark.parametrize("start,end", [(0, 0), (5, 4), (float("nan"), 5), (4, float("inf"))])
def test_invalid_word_times_never_become_coarse_asserted_text(start, end):
    line, warnings = adapt_segment(segment(start=start, end=end, average=-0.1), 30)
    assert line is None and warnings == ["word_timing_unreliable"]


def test_valid_zero_start_is_preserved_without_intro_offset():
    line, _ = adapt_segment(segment(start=0, end=1.7, average=-0.1), 30)
    assert line["start"] == 0 and line["end"] == 1.7 and line["text"] == "sing"


def test_sustained_native_word_is_never_published_with_sdk_compressed_end():
    item = segment(average=-0.1, start=4.2, end=4.7)
    line, warnings = adapt_segment(item, 30, [{"word": "sing", "start": 4.2, "end": 8.0}])
    assert line["text"] == "sing" and line["words"] == [] and line["uncertain"]
    assert line["start"] == 4.2 and line["end"] == 8.0
    assert "word_timing_unreliable" in warnings


def test_start_after_long_pause_is_coarse_without_stretching_a_word():
    item = segment(average=-0.1, start=18.3, end=19.0)
    line, _ = adapt_segment(item, 30, [{"word": "sing", "start": 0.0, "end": 19.0}])
    assert line["start"] == 0.0 and line["end"] == 19.0 and line["words"] == []


@pytest.mark.parametrize("evidence", [[], [{"word": "sing", "start": 4.7, "end": 4.7}],
                                     [{"word": "sing", "start": -3, "end": 4.7}]])
def test_confident_sdk_word_without_valid_native_anchor_cannot_create_coarse_text(evidence):
    line, warnings = adapt_segment(segment(average=-0.1), 30, evidence)
    assert line is None and "word_timing_unreliable" in warnings


def test_normal_native_rounding_keeps_word_times():
    line, _ = adapt_segment(segment(average=-0.1), 30, [{"word": "sing", "start": 4.196, "end": 4.704}])
    assert line["words"][0]["start"] == 4.2 and line["words"][0]["end"] == 4.7


def test_native_support_is_not_an_instrumental_classifier():
    # Actual instrumental turbo diagnosis: a high-probability "you" has valid
    # raw DTW support. The model must pass audio negative controls separately.
    item = segment(start=1.28, end=1.48, probability=0.9988, average=-0.65, text=" you.")
    native = [{"start": 1.28, "end": 1.48, "word": " you."}]
    assert native_supports(item.words[0], native[0], 30)
    line, _ = adapt_segment(item, 30, native)
    assert line["text"] == "you."


def test_no_speech_and_weak_average_jointly_skip_segment():
    item = segment()
    item.no_speech_prob = 0.9
    assert adapt_segment(item, 30)[0] is None


def test_confident_singing_with_high_no_speech_is_retained():
    item = segment(average=-0.2)
    item.no_speech_prob = 0.9
    line, _ = adapt_segment(item, 30)
    assert line["text"] == "sing"
