"""Conservative adaptation of singing hypotheses on the original timeline.

Probability alone does not distinguish singing from instrumental hallucination.
This module preserves the old repetitive-window mask and never creates text or
word spans from a segment's untimed text. In nonrepetitive low-logprob windows,
an individually strong token may be retained only with native DTW support.
"""

from copy import deepcopy
import math

ADAPTER_VERSION = "conservative-singing-v3"
RECOVERY_WORD_PROBABILITY = 0.70
MATERIAL_TIMING_ADJUSTMENT_SECONDS = 0.20


def _field(value, name, default=None):
    return value.get(name, default) if isinstance(value, dict) else getattr(value, name, default)


def _interval(start, end, duration):
    try:
        start, end = float(start), float(end)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(start) or not math.isfinite(end):
        return None
    start, end = max(0.0, start), min(duration, end)
    return (start, end) if end > start else None


def native_supports(word, evidence, duration):
    """Require matching lexical evidence and a genuine, nonzero native span.

    A rounding tolerance of one 20ms alignment frame accommodates the SDK's
    decimal rounding. No native boundary is stretched to fit the song/line.
    """
    original = native_interval(word, evidence, duration)
    adjusted = _interval(_field(word, "start"), _field(word, "end"), duration)
    if not original or not adjusted:
        return False
    return adjusted[0] >= original[0] - 0.021 and adjusted[1] <= original[1] + 0.021


def native_interval(word, evidence, duration):
    if evidence is None or _field(word, "word", "") != evidence.get("word"):
        return None
    try:
        start, end = float(evidence["start"]), float(evidence["end"])
    except (KeyError, TypeError, ValueError):
        return None
    if (not math.isfinite(start) or not math.isfinite(end) or start < 0 or
            end <= start or end > duration + 0.021):
        return None
    return start, min(end, duration)


def adapt_segment(segment, duration, native_words=None, *, legacy=False):
    """Return one honest line and warnings, or no line when no timing survives.

    `legacy` is reserved for same-native evaluation; normal inference always
    uses the conservative v3 adapter. It changes no model output or sampling.
    """
    average = float(_field(segment, "avg_logprob", -math.inf))
    compression = float(_field(segment, "compression_ratio", math.inf))
    no_speech = float(_field(segment, "no_speech_prob", 1.0))
    if no_speech >= 0.6 and average < -1.0:
        return None, []
    weak = not math.isfinite(average) or average < -1.0
    repetitive = not math.isfinite(compression) or compression > 2.4
    warnings, words, anchors = [], [], []
    coarse = False
    source_words = _field(segment, "words", []) or []
    native_checked = native_words is not None and not legacy
    native_words = native_words if native_words is not None else []
    for index, word in enumerate(source_words):
        interval = _interval(_field(word, "start"), _field(word, "end"), duration)
        if interval is None:
            warnings.append("word_timing_unreliable")
            continue
        token = str(_field(word, "word", "")).strip()
        if not token:
            continue
        native = native_words[index] if index < len(native_words) else None
        original = native_interval(word, native, duration)
        if native_checked:
            if original is None:
                # Neither a zero-duration DTW token nor absent evidence can
                # become asserted coarse text using a guessed line duration.
                warnings.extend(("word_timing_unreliable", "lyrics_unreliable"))
                coarse = True
                continue
            anchors.append(original)
            if max(abs(interval[0] - original[0]), abs(interval[1] - original[1])) > MATERIAL_TIMING_ADJUSTMENT_SECONDS:
                coarse = True
                warnings.append("word_timing_unreliable")
        confidence = float(_field(word, "probability", 0.0))
        confidence = max(0.0, min(1.0, confidence)) if math.isfinite(confidence) else 0.0
        uncertain = weak or repetitive or confidence < 0.35
        recovered = (not legacy and weak and not repetitive and
                     confidence >= RECOVERY_WORD_PROBABILITY and native_supports(word, native, duration))
        words.append({"start": interval[0], "end": interval[1],
                      "text": token if not uncertain or recovered else "…",
                      "confidence": confidence, "uncertain": uncertain})
    if not words:
        return None, sorted(set(warnings))
    uncertain = coarse or any(word["uncertain"] for word in words)
    if uncertain:
        warnings.append("lyrics_unreliable")
    start, end = words[0]["start"], words[-1]["end"]
    if coarse and anchors:
        # This is an explicitly approximate line interval: the envelope of
        # actual SDK/native evidence, never uniformly redistributed word spans.
        start = min(start, *(interval[0] for interval in anchors))
        end = max(end, *(interval[1] for interval in anchors))
    return {"start": start, "end": end,
            "text": " ".join(word["text"] for word in words),
            "words": [] if coarse else words, "uncertain": uncertain}, sorted(set(warnings))


def capture_native_alignment(model):
    """Observe pinned faster-whisper 1.2.1 without modifying its alignment.

    Raw DTW is copied before the SDK's duration heuristics. Punctuation and
    token counts are mapped exactly as in its MIT-licensed add_word_timestamps.
    An unrecognized/missing mapping yields no recovery evidence, never invented
    word times. The cache holds only the current model window.
    """
    if not hasattr(model, "find_alignment") or not hasattr(model, "add_word_timestamps"):
        return lambda segment: []
    from faster_whisper.transcribe import merge_punctuations
    original_find = model.find_alignment
    original_add = model.add_word_timestamps
    raw, evidence = [], {}

    def find(*arguments, **keywords):
        nonlocal raw
        aligned = original_find(*arguments, **keywords)
        raw = deepcopy(aligned)
        return aligned

    def add(segments, tokenizer, encoder_output, num_frames,
            prepend_punctuations, append_punctuations, last_speech_timestamp):
        nonlocal raw
        raw = []
        evidence.clear()
        result = original_add(segments, tokenizer, encoder_output, num_frames,
                              prepend_punctuations, append_punctuations, last_speech_timestamp)
        if len(raw) != len(segments):
            return result
        for group, alignment in zip(segments, raw):
            merge_punctuations(alignment, prepend_punctuations, append_punctuations)
            if not group:
                continue
            offset = group[0]["seek"] / model.frames_per_second
            word_index = 0
            for subsegment in group:
                expected = sum(token < tokenizer.eot for token in subsegment["tokens"])
                consumed, native = 0, []
                while word_index < len(alignment) and consumed < expected:
                    timing = alignment[word_index]
                    if timing["word"]:
                        native.append({"word": timing["word"],
                                       "start": float(offset + timing["start"]),
                                       "end": float(offset + timing["end"])})
                    consumed += len(timing["tokens"])
                    word_index += 1
                adjusted = subsegment.get("words", [])
                if (len(native) == len(adjusted) and consumed == expected and
                        all(a["word"] == b["word"] for a, b in zip(native, adjusted))):
                    key = (subsegment["seek"], subsegment["start"], subsegment["end"],
                           tuple(subsegment["tokens"]))
                    evidence[key] = native
        return result

    model.find_alignment = find
    model.add_word_timestamps = add

    def retrieve(segment):
        return evidence.get((_field(segment, "seek"), _field(segment, "start"),
                             _field(segment, "end"), tuple(_field(segment, "tokens", []))), [])
    return retrieve
