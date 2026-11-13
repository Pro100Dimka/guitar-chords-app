#!/usr/bin/env python3
"""Evaluate one frozen raw-DTW timing alternative on saved real model evidence.

This does not run ASR and is not used by the app/service. Its input is native.json
from evaluate_quality_v3.py; reference words are loaded only after every output
has been produced. Text confidence/masking rules match v3; only the published
time intervals change. It must not replace a production policy without a full
paired comparison and an integrated actual-model HTTP check.
"""

from copy import deepcopy
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from freetune_analysis.singing import native_interval, native_supports, _interval
from freetune_analysis.pipeline import disjoint_lyrics, remove_non_lyric_captions

POLICY = "raw-dtw-evaluation-v1"


def raw_segment(segment, native_words, duration):
    """Use genuine DTW intervals; never uniformly redistribute or cap durations."""
    average = float(segment.get("avg_logprob", -math.inf))
    compression = float(segment.get("compression_ratio", math.inf))
    if float(segment.get("no_speech_prob", 1)) >= 0.6 and average < -1:
        return None, []
    weak = not math.isfinite(average) or average < -1
    repetitive = not math.isfinite(compression) or compression > 2.4
    words, warnings = [], []
    for index, word in enumerate(segment.get("words") or []):
        native = native_words[index] if index < len(native_words) else None
        sdk = _interval(word.get("start"), word.get("end"), duration)
        raw = native_interval(word, native, duration)
        token = str(word.get("word", "")).strip()
        if sdk is None or not token:
            warnings.append("word_timing_unreliable")
            continue
        if raw is None:
            warnings.extend(("word_timing_unreliable", "lyrics_unreliable"))
            continue
        probability = float(word.get("probability", 0))
        confidence = max(0.0, min(1.0, probability)) if math.isfinite(probability) else 0.0
        lexical_uncertainty = weak or repetitive or confidence < 0.35
        recovered = (weak and not repetitive and confidence >= 0.70 and
                     native_supports(word, native, duration))
        timing_uncertainty = max(abs(sdk[0] - raw[0]), abs(sdk[1] - raw[1])) > 0.20
        if timing_uncertainty:
            warnings.append("word_timing_unreliable")
        words.append({"start": raw[0], "end": raw[1],
                      "text": token if not lexical_uncertainty or recovered else "…",
                      "confidence": confidence,
                      "uncertain": lexical_uncertainty or timing_uncertainty})
    if not words:
        return None, sorted(set(warnings))
    uncertain = any(word["uncertain"] for word in words)
    if uncertain:
        warnings.append("lyrics_unreliable")
    return {"start": words[0]["start"], "end": words[-1]["end"],
            "text": " ".join(word["text"] for word in words), "words": words,
            "uncertain": uncertain}, sorted(set(warnings))


def transform(native, analysis):
    lines, warnings = [], []
    for item in native["segments"]:
        line, extra = raw_segment(item["segment"], item["nativeWords"], analysis["duration"])
        if line:
            lines.append(line)
        warnings.extend(extra)
    lines, unreliable = disjoint_lyrics(lines)
    lines, omitted = remove_non_lyric_captions(lines)
    if unreliable:
        warnings.append("word_timing_unreliable")
    if omitted:
        warnings.append("non_lyric_caption_omitted")
    if not lines:
        warnings.append("no_lyrics")
    result = deepcopy(analysis)
    result["lyrics"] = lines
    lyric_codes = {"word_timing_unreliable", "lyrics_unreliable", "no_lyrics", "non_lyric_caption_omitted"}
    result["warnings"] = sorted(set(warnings + [w for w in analysis["warnings"] if w not in lyric_codes]))
    result["model"]["alignment"] = POLICY + "; evaluation only, not approved production"
    # No new model inference or separate memory/time measurement took place.
    result.pop("metrics", None)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, action="append", default=[])
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Refusing to overwrite an existing raw-timing experiment")
    args.output.mkdir(parents=True)
    # All hypotheses are finalized before any reference file is opened.
    entries = []
    for directory in sorted((args.run / "results").iterdir()):
        if not (directory / "native.json").is_file() or not (directory / "measurement.json").is_file():
            continue
        state = json.loads((directory / "state.json").read_text())
        if state.get("status") not in {"completed", "partial"}:
            continue
        native = json.loads((directory / "native.json").read_text())
        result = transform(native, state["result"])
        file = args.output / (directory.name + ".analysis.json")
        file.write_text(json.dumps({**state, "result": result}, ensure_ascii=False, indent=2) + "\n")
        entries.append((directory, state["result"], result))
    from freetune_analysis.quality_metrics import score_lyrics, paired_timing, tokens
    records = {}
    for manifest_path in args.manifest:
        manifest = json.loads(manifest_path.read_text())
        for record in manifest["recordings"]:
            records[record["id"]] = (record, manifest_path.parent)
    rows = []
    for directory, coarse, raw in entries:
        record, parent = records.get(directory.name, ({}, args.run))
        reference = json.loads((parent / record["reference"]).read_text()) if record.get("reference") else {}
        legacy = json.loads((directory / "legacy-result.json").read_text())
        before, old_matches = score_lyrics(reference, legacy)
        after, new_matches = score_lyrics(reference, raw)
        current, _ = score_lyrics(reference, coarse)
        raw_tokens = tokens(" ".join(line["text"] for line in raw["lyrics"]), markers=True)
        coarse_tokens = tokens(" ".join(line["text"] for line in coarse["lyrics"]), markers=True)
        rows.append({"id": directory.name, "language": record.get("language"),
                     "legacy": before, "coarse": current, "raw": after,
                     "pairedTiming": paired_timing(old_matches, new_matches),
                     "identicalTextToV3": raw_tokens == coarse_tokens,
                     "lexicalWords": len(tokens(" ".join(line["text"] for line in raw["lyrics"]))),
                     "sourceEvidenceSha256": hashlib.sha256((directory / "native.json").read_bytes()).hexdigest()})
    report = {"policy": POLICY, "productionAccepted": False, "newInference": False,
              "humanReferencesUsedOnlyAfterOutputs": True, "recordings": rows}
    (args.output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"recordings": len(rows), "textDifferences": [r["id"] for r in rows if not r["identicalTextToV3"]],
                      "output": str(args.output / "report.json")}))


if __name__ == "__main__":
    main()
