#!/usr/bin/env python3
"""Small interval semantics checks; no audio, model inference or real annotations."""
import argparse
import copy
import importlib.util
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location("section", Path(__file__).with_name("inspect-offline-chord-section.py"))
S = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(S)


def prediction(segments, duration=6):
    return {"duration": duration, "segments": [dict(start=a, end=b, chord=c) for a, b, c in segments]}


def reference(segments, duration=6):
    annotation = {"namespace": "chord", "data": [dict(time=a, duration=b-a, value=c) for a, b, c in segments]}
    return {"file_metadata": {"duration": duration}, "annotations": [annotation, copy.deepcopy(annotation)]}


class SectionSemantics(unittest.TestCase):
    def test_mid_chord_clips_absolute_times_without_relabeling(self):
        result = S.inspect(prediction([(0, 3, "Em"), (3, 6, "G6")]), 1, 4)
        self.assertEqual([(s["start"], s["end"], s["chord"]) for s in result["segments"]], [(1, 3, "Em"), (3, 4, "G6")])
        self.assertEqual(result["segments"][0]["sourceStart"], 0)
        self.assertTrue(result["segments"][0]["startClipped"])
        self.assertTrue(result["segments"][1]["endClipped"])
        self.assertNotIn("references", result)

    def test_gaps_and_unknown_do_not_inflate_known_duration_score(self):
        pred = prediction([(0, 1, "C"), (2, 3, "X"), (3, 4, "N"), (4, 6, "G")])
        truth = reference([(0, 3, "C"), (3, 4, "N"), (4, 5, "X")])
        result = S.inspect(pred, 0, 6, truth)
        score = result["references"]["instructed"]
        self.assertEqual(result["predictionGapSeconds"], 1)
        self.assertEqual(result["predictedXSeconds"], 1)
        self.assertEqual(result["predictedNSeconds"], 1)
        self.assertEqual(score["missingPredictionSeconds"], 1)
        self.assertEqual(score["excludedUnknownReferenceSeconds"], 1)
        self.assertEqual(score["unannotatedReferenceSeconds"], 1)
        self.assertEqual(score["metrics"]["exactRootAndFormula"]["evaluatedSeconds"], 4)
        self.assertEqual(score["metrics"]["exactRootAndFormula"]["value"], 0.5)
        self.assertEqual(score["metrics"]["majorMinorProjection"]["evaluatedSeconds"], 3)

    def test_same_pitches_keep_different_roots_and_roles(self):
        truth = reference([(0, 6, "Csus2")])
        truth["annotations"][1]["data"][0]["value"] = "Gsus4"
        result = S.inspect(prediction([(0, 6, "Gsus4")]), 1, 4, truth)
        metrics = result["references"]["instructed"]["metrics"]
        self.assertEqual(metrics["exactRootAndFormula"]["value"], 0)
        self.assertEqual(metrics["rootOnly"]["value"], 0)
        self.assertEqual(metrics["pitchClassJaccard"]["value"], 1)
        self.assertEqual(result["references"]["performed"]["metrics"]["exactRootAndFormula"]["value"], 1)

    def test_invalid_ranges_and_off_section_corruption_fail(self):
        pred = prediction([(0, 6, "C")])
        for start, end in [(1, 1), (2, 1), (-1, 2), (0, 7), (float("nan"), 2), (0, float("inf")), (False, 2)]:
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                S.inspect(pred, start, end)
        for bad in [prediction([(0, 2, "C"), (4, 7, "G")]), prediction([(0, 2, "C"), (4, 5, "C9bad")]), prediction([(0, 2, "C"), (4, 6, "G"), (5, 6, "A")])]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                S.inspect(bad, 0, 1)
        with self.assertRaises(ValueError):
            S.inspect(pred, 0, 1, reference([(0, 6, "C")], duration=7))
        with self.assertRaises(ValueError):
            S.inspect(pred, 0, 1, reference([(0, 7, "C")]))
        bad = reference([(0, 6, "C")])
        bad["annotations"].pop()
        with self.assertRaises(ValueError):
            S.inspect(pred, 0, 1, bad)

    def test_timestamp_parsing_and_half_open_boundary(self):
        self.assertEqual(S.timestamp("1:02.5"), 62.5)
        self.assertEqual(S.timestamp("62.5"), 62.5)
        for text in ("1:60", "nan", "inf", "-1:02", "1:02:03"):
            with self.subTest(text=text), self.assertRaises(argparse.ArgumentTypeError):
                S.timestamp(text)
        result = S.inspect(prediction([(0, 3, "C"), (3, 6, "G")]), 3, 4)
        self.assertEqual([s["chord"] for s in result["segments"]], ["G"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
