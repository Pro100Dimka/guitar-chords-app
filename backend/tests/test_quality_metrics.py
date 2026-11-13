import pytest

from freetune_analysis.quality_metrics import align, paired_timing, score_lyrics, timed_matches, tokens


@pytest.mark.parametrize("ref,hyp,expected", [
    ([], [], (0, 0, 0)), (["a"], [], (0, 0, 1)), ([], ["a"], (0, 1, 0)),
    (["a"], ["b"], (1, 0, 0)), (["a", "b"], ["a", "b"], (0, 0, 0)),
])
def test_error_types(ref, hyp, expected):
    measured = align(ref, hyp)
    assert tuple(measured[key] for key in ("substitutions", "insertions", "deletions")) == expected
    assert measured["errors"] == sum(expected)


def test_unicode_normalization_preserves_ukrainian_russian_and_apostrophes():
    assert tokens("I’M Співаю, ПОЮ!") == ["i'm", "співаю", "пою"]


def test_lexical_and_marker_aware_metrics_are_separate():
    measured, _ = score_lyrics({"text": "sing"}, {"lyrics": [{"text": "… …", "words": []}]})
    assert measured["wer"] == 1.0 and measured["markerAwareWer"] == 2.0


def test_missing_human_reference_has_no_invented_accuracy_score():
    measured, _ = score_lyrics({}, {"lyrics": [{"text": "some words", "words": []}]})
    assert measured["wer"] is None and measured["wordErrors"] is None


def test_coarse_repetition_stays_in_alignment_but_has_no_timing_credit():
    reference = {"words": [{"text": "go", "start": 1, "end": 2},
                            {"text": "go", "start": 5, "end": 6}]}
    result = {"lyrics": [{"text": "go", "words": []}, {"text": "go", "words": [
        {"text": "go", "start": 5.2, "end": 6.2}]}]}
    matches, count = timed_matches(reference, result)
    assert count == 2 and set(matches) == {1}
    assert matches[1]["startError"] == pytest.approx(0.2)


def test_invalid_word_span_does_not_receive_timing_credit():
    reference = {"text": "go", "words": [{"text": "go", "start": 1, "end": 2}]}
    measured, _ = score_lyrics(reference, {"lyrics": [{"text": "go", "words": [
        {"text": "go", "start": 1, "end": 1}]}]})
    assert measured["wer"] == 0 and measured["timedExactWords"] == 0


def test_paired_timing_uses_only_identical_reference_positions():
    before = {0: {"startError": 10, "endError": 10}, 1: {"startError": 0.2, "endError": 0.3}}
    after = {1: {"startError": 0.1, "endError": 0.2}, 2: {"startError": 0, "endError": 0}}
    paired = paired_timing(before, after)
    assert paired["sameReferenceWords"] == 1
    assert paired["legacyStartMaeSeconds"] == 0.2 and paired["candidateStartMaeSeconds"] == 0.1
