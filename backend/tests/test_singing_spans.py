import pytest

from freetune_analysis.pipeline import remove_non_lyric_captions
from freetune_analysis.singing_spans import SpanAdapter


def add(adapter, values, *, compression=1.1):
    words = [{"word": text, "start": sdk_start, "end": sdk_end, "probability": 0.9}
             for text, sdk_start, sdk_end, raw_start, raw_end in values]
    native = [{"word": text, "start": raw_start, "end": raw_end}
              for text, sdk_start, sdk_end, raw_start, raw_end in values]
    adapter.add({"avg_logprob": -0.2, "no_speech_prob": 0.1,
                 "compression_ratio": compression, "words": words}, native)


def adapter():
    return SpanAdapter(60, remove_non_lyric_captions)


def test_held_word_is_coarse_while_neighbouring_true_word_spans_survive():
    value = adapter()
    add(value, [("a", 1, 2, 1, 2), ("held", 2, 3, 2, 5), ("note", 5, 6, 5, 6)])
    lines, warnings = value.result()
    assert [line["text"] for line in lines] == ["a", "held", "note"]
    assert lines[1] == {"start": 2, "end": 5, "text": "held", "words": [], "uncertain": True}
    assert lines[0]["words"][0]["start"] == 1 and lines[2]["words"][0]["end"] == 6
    assert "word_timing_unreliable" in warnings


def test_long_pause_does_not_remove_later_precise_word_times():
    value = adapter()
    add(value, [("first", 9, 10, 0, 10), ("next", 10, 11, 10, 11), ("word", 11, 12, 11, 12)])
    lines, _ = value.result()
    assert lines[0]["start"] == 0 and lines[0]["words"] == []
    assert lines[1]["text"] == "next word" and len(lines[1]["words"]) == 2


def test_overlap_is_resolved_before_regrouping_a_long_reliable_run():
    value = adapter()
    add(value, [("a", 1, 2, 1, 2), ("b", 2, 3, 2, 6)])
    add(value, [("c", 5, 7, 5, 7), ("d", 7, 8, 7, 8), ("e", 8, 9, 8, 9)])
    lines, _ = value.result()
    assert [line["text"] for line in lines] == ["a", "b c", "d e"]
    assert lines[1]["start"] == 2 and lines[1]["end"] == 7 and lines[1]["words"] == []
    assert len(lines[2]["words"]) == 2


def test_backwards_overlap_merges_only_connected_source_ordered_units():
    value = adapter()
    add(value, [("a", 1, 2, 1, 2), ("b", 2, 3, 2, 3), ("c", 3, 4, 0, 4), ("d", 4, 5, 4, 5)])
    lines, _ = value.result()
    assert lines[0]["text"] == "a b c" and lines[0]["words"] == []
    assert lines[0]["start"] == 0 and lines[0]["end"] == 4
    assert lines[1]["text"] == "d" and len(lines[1]["words"]) == 1


def test_caption_decision_uses_whole_line_v3_group_before_splitting():
    value = adapter()
    add(value, [("[MUSIC]", 0, 1, 0, 4)])
    add(value, [("lyrics", 3, 5, 3, 5)])
    lines, _ = value.result()
    assert " ".join(line["text"] for line in lines) == "[MUSIC] lyrics"
    standalone = adapter()
    add(standalone, [("[MUSIC]", 0, 1, 0, 1)])
    assert standalone.result()[0] == []


def test_invalid_native_token_is_omitted_without_untiming_valid_neighbours():
    value = adapter()
    add(value, [("a", 1, 2, 1, 2), ("invented", 2, 3, 2.5, 2.5), ("b", 3, 4, 3, 4)])
    lines, _ = value.result()
    assert len(lines) == 1 and lines[0]["text"] == "a b" and len(lines[0]["words"]) == 2


def test_repetitive_text_stays_masked_even_with_reliable_native_timing():
    value = adapter()
    add(value, [("loop", 1, 2, 1, 2), ("loop", 2, 3, 2, 3)], compression=5)
    assert value.result()[0][0]["text"] == "… …"


def test_reliable_time_uses_raw_dtw_without_sdk_duration_adjustment():
    value = adapter()
    add(value, [("word", 1.1, 2, 1, 2.05)])
    line = value.result()[0][0]
    assert line["words"][0]["start"] == 1 and line["words"][0]["end"] == 2.05


def test_inconsistent_source_order_fails_instead_of_guessing():
    value = adapter()
    add(value, [("later", 10, 11, 10, 11)])
    add(value, [("earlier", 1, 2, 1, 2)])
    with pytest.raises(ValueError, match="source_order"):
        value.result()
