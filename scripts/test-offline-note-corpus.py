#!/usr/bin/env python3
"""Check comparison accounting without audio, native inference or real fixtures."""

import copy
import importlib.util
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "note_corpus", Path(__file__).with_name("compare-offline-note-corpus.py"))
C = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(C)


def metric(reference, predicted, matched):
    return {"referenceCount": reference, "predictionCount": predicted,
            "matchedCount": matched, "falsePositives": predicted - matched,
            "falseNegatives": reference - matched,
            "precision": matched / predicted if predicted else 0.0,
            "recall": matched / reference if reference else 0.0,
            "f1": 2 * matched / (reference + predicted) if reference + predicted else 0.0}


def record(track, baseline, current):
    return {"track": track, "status": "complete",
            "baseline": {key: baseline for key in C.CRITERIA},
            "current": {key: current for key in C.CRITERIA},
            "delta": {key: C.differences(current, baseline) for key in C.CRITERIA}}


def corpus():
    return [record(str(index), metric(10, 10, 10), metric(10, 10, 10)) for index in range(12)]


class CorpusAccounting(unittest.TestCase):
    def test_micro_uses_total_counts_not_an_average_of_track_scores(self):
        result = C.micro([metric(100, 100, 100), metric(2, 4, 0)])
        self.assertEqual((result["referenceCount"], result["predictionCount"],
                          result["matchedCount"], result["falsePositives"],
                          result["falseNegatives"]), (102, 104, 100, 4, 2))
        self.assertAlmostEqual(result["precision"], 100 / 104)
        self.assertAlmostEqual(result["recall"], 100 / 102)
        self.assertAlmostEqual(result["f1"], 200 / 206)
        self.assertNotEqual(result["f1"], 0.5)

    def test_missing_failed_or_globally_invalid_evidence_has_no_aggregate(self):
        complete = corpus()
        failed = copy.deepcopy(complete)
        failed[-1] = {"track": "11", "status": "failed", "error": "native output invalid"}
        for records, error in (([], None), (complete[:-1], None), (failed, None),
                               (complete, {"message": "last report write failed"})):
            with self.subTest(records=len(records), error=error):
                result = C.comparison(records, error)
                self.assertFalse(result["complete"])
                self.assertIsNone(result["micro"])
                self.assertIsNone(result["regressions"])

    def test_improved_f1_does_not_hide_recall_regression(self):
        records = corpus()
        records[0] = record("0", metric(271, 400, 200), metric(271, 200, 190))
        result = C.comparison(records)
        self.assertTrue(result["complete"])
        self.assertGreater(result["micro"]["delta"]["onsetPitch"]["f1"], 0)
        self.assertLess(result["micro"]["delta"]["onsetPitch"]["recall"], 0)
        self.assertEqual([(item["track"], item["criterion"], item["metrics"])
                          for item in result["regressions"]],
                         [("0", "onsetPitch", ["recall"]),
                          ("0", "onsetPitchOffset", ["recall"])])


if __name__ == "__main__":
    unittest.main()
