"""Evaluation-only lyric and paired timing metrics; never imported by inference."""

from array import array
import math
import re
import unicodedata


def tokens(text, markers=False):
    # NFKC changes U+2026 to three periods. Protect uncertainty markers before
    # normalization, otherwise the purported marker-aware metric drops them.
    normalized = unicodedata.normalize("NFKC", text.replace("…", "\ue000")).lower().replace("’", "'")
    pattern = r"[^\W_]+(?:'[^\W_]+)*" + ("|\ue000" if markers else "")
    return [token.replace("\ue000", "…") for token in re.findall(pattern, normalized, re.UNICODE)]


def align(reference, hypothesis):
    """Unit-cost Levenshtein with explicit edits and exact token matches."""
    costs = [array("I", range(len(hypothesis) + 1))]
    for index, expected in enumerate(reference, 1):
        previous, row = costs[-1], array("I", [index])
        for position, observed in enumerate(hypothesis, 1):
            row.append(min(previous[position] + 1, row[-1] + 1,
                           previous[position - 1] + (expected != observed)))
        costs.append(row)
    i, j, matches = len(reference), len(hypothesis), []
    edits = {"substitutions": 0, "insertions": 0, "deletions": 0}
    while i or j:
        if i and j and costs[i][j] == costs[i - 1][j - 1] + (reference[i - 1] != hypothesis[j - 1]):
            if reference[i - 1] == hypothesis[j - 1]:
                matches.append((i - 1, j - 1))
            else:
                edits["substitutions"] += 1
            i, j = i - 1, j - 1
        elif i and costs[i][j] == costs[i - 1][j] + 1:
            edits["deletions"] += 1
            i -= 1
        else:
            edits["insertions"] += 1
            j -= 1
    return {**edits, "errors": costs[-1][-1], "matches": list(reversed(matches))}


def valid_interval(word):
    start, end = word.get("start"), word.get("end")
    return (isinstance(start, (float, int)) and isinstance(end, (float, int)) and
            math.isfinite(start) and math.isfinite(end) and 0 <= start < end)


def timed_matches(reference, result):
    reference_tokens = [(token, word) for word in reference.get("words", [])
                        for token in tokens(word["text"])]
    hypothesis = []
    for line in result.get("lyrics", []):
        words = line.get("words", [])
        line_tokens = tokens(line["text"], markers=True)
        word_tokens = [(token, word) for word in words for token in tokens(word["text"], markers=True)]
        # Keep coarse text in the alignment sequence. Removing it before text
        # alignment can falsely match later repetitions to earlier references.
        if [token for token, _ in word_tokens] == line_tokens:
            hypothesis.extend(word_tokens)
        else:
            hypothesis.extend((token, None) for token in line_tokens)
    alignment = align([token for token, _ in reference_tokens], [token for token, _ in hypothesis])
    supported = {}
    for ref_index, hyp_index in alignment["matches"]:
        reference_word, observed_word = reference_tokens[ref_index][1], hypothesis[hyp_index][1]
        if observed_word and valid_interval(reference_word) and valid_interval(observed_word):
            supported[ref_index] = {
                "startError": abs(reference_word["start"] - observed_word["start"]),
                "endError": abs(reference_word["end"] - observed_word["end"]),
            }
    return supported, sum(valid_interval(word) for _, word in reference_tokens)


def score_lyrics(reference, result):
    text = "\n".join(line["text"] for line in result.get("lyrics", []))
    expected = tokens(reference.get("text", ""))
    primary = align(expected, tokens(text))
    marker_aware = align(expected, tokens(text, markers=True))
    matches, timed_reference = timed_matches(reference, result)
    count = len(matches)
    return {
        "referenceWords": len(expected), "predictedLexicalWords": len(tokens(text)),
        "wordErrors": primary["errors"] if expected else None,
        "wer": primary["errors"] / len(expected) if expected else None,
        "substitutions": primary["substitutions"] if expected else None,
        "insertions": primary["insertions"] if expected else None,
        "deletions": primary["deletions"] if expected else None,
        "markerAwareErrors": marker_aware["errors"] if expected else None,
        "markerAwareWer": marker_aware["errors"] / len(expected) if expected else None,
        "timingReferenceWords": timed_reference, "timedExactWords": count,
        "timedExactCoverage": count / timed_reference if timed_reference else None,
        "startErrorSumSeconds": sum(value["startError"] for value in matches.values()),
        "endErrorSumSeconds": sum(value["endError"] for value in matches.values()),
        "startMaeSeconds": sum(value["startError"] for value in matches.values()) / count if count else None,
        "endMaeSeconds": sum(value["endError"] for value in matches.values()) / count if count else None,
        "coarseLines": sum(not line.get("words") for line in result.get("lyrics", [])),
    }, matches


def paired_timing(before, after):
    common = sorted(set(before).intersection(after))
    count = len(common)
    result = {"sameReferenceWords": count}
    for name, values in (("legacy", before), ("candidate", after)):
        for boundary in ("start", "end"):
            total = sum(values[index][boundary + "Error"] for index in common)
            result[name + boundary.title() + "ErrorSumSeconds"] = total
            result[name + boundary.title() + "MaeSeconds"] = total / count if count else None
    return result
