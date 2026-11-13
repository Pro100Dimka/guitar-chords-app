#!/usr/bin/env python3
"""Evaluate the frozen local-span timing policy using cached actual model evidence.

Every hypothesis is written before human reference files are opened. This is a
postprocessor ablation, not a new ASR/resource benchmark or an independent holdout.
"""

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from freetune_analysis.pipeline import remove_non_lyric_captions
from freetune_analysis.singing_spans import ADAPTER_VERSION, adapt_native_spans


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", "utf-8")


def aggregate(rows, name):
    scores = [row[name] for row in rows if row[name]["wer"] is not None]
    counts = {key: sum(score[key] for score in scores) for key in
              ("referenceWords", "wordErrors", "markerAwareErrors", "timingReferenceWords",
               "timedExactWords", "startErrorSumSeconds", "endErrorSumSeconds", "coarseLines")}
    counts["recordings"] = len(scores)
    for key, numerator, denominator in (
        ("wer", "wordErrors", "referenceWords"),
        ("markerAwareWer", "markerAwareErrors", "referenceWords"),
        ("timedExactCoverage", "timedExactWords", "timingReferenceWords"),
        ("startMaeSeconds", "startErrorSumSeconds", "timedExactWords"),
        ("endMaeSeconds", "endErrorSumSeconds", "timedExactWords"),
    ):
        counts[key] = counts[numerator] / counts[denominator] if counts[denominator] else None
    return counts


def aggregate_pairs(rows, field):
    pairs = [row[field] for row in rows]
    count = sum(pair["sameReferenceWords"] for pair in pairs)
    result = {"sameReferenceWords": count}
    for side in ("legacy", "candidate"):
        for boundary in ("Start", "End"):
            key = side + boundary
            total = sum(pair[key + "ErrorSumSeconds"] for pair in pairs)
            result[key + "MaeSeconds"] = total / count if count else None
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected", type=int, default=45)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Refusing to overwrite a fixed-policy experiment")
    args.output.mkdir(parents=True)
    expected, entries, validation_records = [], [], []
    for run in args.run:
        plan = json.loads((run / "plan.json").read_text("utf-8"))
        for record in plan["recordings"]:
            identity = record["id"]
            folder = run / "results" / identity
            if not (folder / "measurement.json").is_file():
                raise ValueError("Missing completed model evidence: " + identity)
            state = json.loads((folder / "state.json").read_text("utf-8"))
            if state["status"] != "completed":
                raise ValueError("Incomplete original model job: " + identity)
            native_path = folder / "native.json"
            native = json.loads(native_path.read_text("utf-8"))
            coarse = state["result"]
            lines, warnings = adapt_native_spans(native["segments"], coarse["duration"], remove_non_lyric_captions)
            hypothesis = deepcopy(coarse)
            lyric_codes = {"word_timing_unreliable", "lyrics_unreliable", "no_lyrics", "non_lyric_caption_omitted"}
            hypothesis.update(lyrics=lines, warnings=sorted(set(warnings + [w for w in coarse["warnings"] if w not in lyric_codes])))
            hypothesis["model"]["alignment"] = ADAPTER_VERSION + "; cached evaluation, not approved production"
            hypothesis.pop("metrics", None)
            write(args.output / (identity + ".analysis.json"), {**state, "result": hypothesis})
            entries.append((record, folder, coarse, hypothesis))
            expected.append(identity)
            validation_records.append({"id": identity, "audio": record["audio"], "audioSha256": state["audio_sha256"]})
    if len(entries) != args.expected or len(set(expected)) != len(expected):
        raise ValueError("Wrong number/duplicate hypotheses; no scoring performed")
    write(args.output / "validator-manifest.json", {"corpus": {"name": "Fixed native-span timing experiment45"},
                                                   "recordings": validation_records})

    # Human references are opened only after all expected hypotheses exist.
    from freetune_analysis.quality_metrics import score_lyrics, paired_timing, tokens
    rows = []
    for record, folder, coarse, hypothesis in entries:
        reference = json.loads(Path(record["reference"]).read_text("utf-8")) if record.get("reference") else {}
        legacy = json.loads((folder / "legacy-result.json").read_text("utf-8"))
        before, before_matches = score_lyrics(reference, legacy)
        current, current_matches = score_lyrics(reference, coarse)
        after, after_matches = score_lyrics(reference, hypothesis)
        old_text = " ".join(line["text"] for line in coarse["lyrics"])
        new_text = " ".join(line["text"] for line in hypothesis["lyrics"])
        rows.append({"id": record["id"], "kind": record["kind"], "language": record["language"],
                     "legacy": before, "coarse": current, "span": after,
                     "pairedLegacy": paired_timing(before_matches, after_matches),
                     "pairedCoarse": paired_timing(current_matches, after_matches),
                     "identicalTextIncludingCaseAndPunctuation": old_text == new_text,
                     "identicalNormalizedTokens": tokens(old_text, markers=True) == tokens(new_text, markers=True),
                     "lyricLines": len(hypothesis["lyrics"]),
                     "coarseSpansAllLanguages": sum(not line["words"] for line in hypothesis["lyrics"]),
                     "lexicalWords": len(tokens(new_text)), "nativeEvidenceSha256": sha256(folder / "native.json")})
    scored = [row for row in rows if row["span"]["wer"] is not None]
    aggregate_legacy = aggregate_pairs(scored, "pairedLegacy")
    regressions = []
    for row in scored:
        pair = row["pairedLegacy"]
        changes = {boundary: pair["candidate" + boundary + "MaeSeconds"] - pair["legacy" + boundary + "MaeSeconds"]
                   for boundary in ("Start", "End") if pair["sameReferenceWords"]}
        if any(change > 0.050 for change in changes.values()):
            regressions.append({"id": row["id"], "sameReferenceWords": pair["sameReferenceWords"], "maeIncreaseSeconds": changes})
    pooled_changes = {boundary: aggregate_legacy["candidate" + boundary + "MaeSeconds"] - aggregate_legacy["legacy" + boundary + "MaeSeconds"]
                      for boundary in ("Start", "End")}
    negatives = [row for row in rows if row["kind"] == "instrumental"]
    checks = {"all45TextIdentical": all(row["identicalTextIncludingCaseAndPunctuation"] for row in rows),
              "instrumentalLexicalWords": sum(row["lexicalWords"] for row in negatives),
              "instrumentalEllipsisOnlyLines": sum(row["lyricLines"] for row in negatives if not row["lexicalWords"]),
              "pooledTimingMaterialRegression": any(value > 0.020 for value in pooled_changes.values()),
              "perSongMaterialTimingRegressions": regressions,
              "pooledMaeChangeSeconds": pooled_changes}
    report = {"schemaVersion": 1, "policy": ADAPTER_VERSION, "productionAccepted": False,
              "newInference": False, "allHypothesesWrittenBeforeReferences": True,
              "independentHoldout": False, "separateInferenceResourcesMeasured": False,
              "sourceSha256": {str(path.relative_to(ROOT)): sha256(path) for path in
                               (ROOT / "backend/freetune_analysis/singing_spans.py", ROOT / "backend/freetune_analysis/singing.py")},
              "expectedRecordings": args.expected, "recordings": rows,
              "summary": {name: aggregate(rows, name) for name in ("legacy", "coarse", "span")},
              "pairedLegacy": aggregate_legacy, "pairedCoarse": aggregate_pairs(scored, "pairedCoarse"),
              "checks": checks,
              "eligibleForIntegrationCheck": checks["all45TextIdentical"] and not checks["instrumentalLexicalWords"]
              and not checks["pooledTimingMaterialRegression"] and not regressions}
    write(args.output / "report.json", report)
    print(json.dumps({"summary": report["summary"], "pairedLegacy": aggregate_legacy,
                      "checks": checks, "eligibleForIntegrationCheck": report["eligibleForIntegrationCheck"]}, indent=2), flush=True)


if __name__ == "__main__":
    main()
