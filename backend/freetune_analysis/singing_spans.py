"""A fixed local fallback for uncertain native singing timestamps.

The coarse-v3 adapter remains the lexical/caption baseline. Reliable words keep
their actual raw DTW spans. Only connected ambiguous/overlapping units become
coarse text, so one questionable boundary does not erase an entire verse's
otherwise supported word times. No word duration is trimmed or redistributed.
"""

from .singing import adapt_segment as adapt_coarse_segment_v3
from .singing import _field, native_interval

ADAPTER_VERSION = "native-span-fallback-v1"


class SpanAdapter:
    def __init__(self, duration, caption_filter):
        self.duration = duration
        self.caption_filter = caption_filter
        self.blocks = []
        self.warnings = set()
        self.order = 0
        self.segment_index = 0

    def add(self, segment, native_words):
        baseline, warnings = adapt_coarse_segment_v3(segment, self.duration, native_words)
        self.warnings.update(warnings)
        segment_index = self.segment_index
        self.segment_index += 1
        if baseline is None:
            return
        context = {name: _field(segment, name) for name in
                   ("avg_logprob", "compression_ratio", "no_speech_prob")}
        units = []
        for index, word in enumerate(_field(segment, "words", []) or []):
            order = self.order
            self.order += 1
            native = native_words[index] if index < len(native_words) else None
            single, _ = adapt_coarse_segment_v3({**context, "words": [word]}, self.duration, [native])
            if single is None:
                continue
            raw = native_interval(word, native, self.duration)
            if raw is None:
                raise ValueError("native_span_evidence_missing")
            coarse = not single["words"]
            if coarse:
                start, end, timed = single["start"], single["end"], None
            else:
                start, end = raw
                timed = {**single["words"][0], "start": start, "end": end}
            units.append({"start": start, "end": end, "text": single["text"],
                          "word": timed, "coarse": coarse, "order": order,
                          "segment": segment_index})
        if " ".join(unit["text"] for unit in units) != baseline["text"]:
            raise ValueError("native_span_text_changed")
        self.blocks.append({"start": baseline["start"], "end": baseline["end"],
                            "text": baseline["text"], "units": units})

    def _caption_groups(self):
        # These bounds/text follow whole-line coarse-v3 disjoint normalization.
        # Caption filtering must see the same text as before splitting: an
        # overlapping '[MUSIC]' plus real lyrics must not lose the first token.
        groups = []
        for block in sorted(self.blocks, key=lambda item: item["start"]):
            if groups and block["start"] < groups[-1]["end"]:
                previous = groups.pop()
                groups.append({"start": previous["start"], "end": max(previous["end"], block["end"]),
                               "text": previous["text"] + " " + block["text"],
                               "units": previous["units"] + block["units"]})
            else:
                groups.append(block)
        kept, omitted = self.caption_filter(groups)
        return kept, omitted

    def result(self):
        groups, omitted = self._caption_groups()
        warnings = set(self.warnings)
        if omitted:
            warnings.add("non_lyric_caption_omitted")
        units = [(group_index, unit) for group_index, group in enumerate(groups) for unit in group["units"]]
        order = [unit["order"] for _, unit in units]
        if order != sorted(order):
            raise ValueError("native_span_source_order_inconsistent")
        components = []
        for group_index, unit in units:
            current = {"start": unit["start"], "end": unit["end"], "coarse": unit["coarse"],
                       "group": group_index, "units": [unit]}
            while components and current["start"] < components[-1]["end"]:
                previous = components.pop()
                if current["end"] <= previous["start"]:
                    raise ValueError("native_span_source_order_inconsistent")
                current = {"start": min(previous["start"], current["start"]),
                           "end": max(previous["end"], current["end"]),
                           "coarse": True, "group": previous["group"],
                           "units": previous["units"] + current["units"]}
            components.append(current)

        lines, keys = [], []
        for component in components:
            text = " ".join(unit["text"] for unit in component["units"])
            if component["coarse"]:
                lines.append({"start": component["start"], "end": component["end"],
                              "text": text, "words": [], "uncertain": True})
                keys.append(None)
                warnings.update(("word_timing_unreliable", "lyrics_unreliable"))
                continue
            unit = component["units"][0]
            key = (unit["segment"], component["group"])
            if lines and keys[-1] == key:
                previous = lines[-1]
                previous["end"] = unit["end"]
                previous["text"] += " " + unit["text"]
                previous["words"].append(unit["word"])
                previous["uncertain"] = previous["uncertain"] or unit["word"]["uncertain"]
            else:
                lines.append({"start": unit["start"], "end": unit["end"], "text": unit["text"],
                              "words": [unit["word"]], "uncertain": unit["word"]["uncertain"]})
                keys.append(key)
        if not lines:
            warnings.add("no_lyrics")
        expected = " ".join(group["text"] for group in groups)
        if " ".join(line["text"] for line in lines) != expected:
            raise ValueError("native_span_text_changed")
        return lines, sorted(warnings)


def adapt_native_spans(native_segments, duration, caption_filter):
    adapter = SpanAdapter(duration, caption_filter)
    for item in native_segments:
        adapter.add(item["segment"], item["nativeWords"])
    return adapter.result()
