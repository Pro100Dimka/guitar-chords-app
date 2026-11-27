#!/usr/bin/env python3
"""Semantic tests for note scoring; no audio, model inference, or real fixtures."""

import copy
import importlib.util
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location("note_evaluation", Path(__file__).with_name("evaluate-offline-note-events.py"))
E = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(E)


def note(start=1.0, end=1.2, midi=60, string=4, onset=0.8):
    return {"start": start, "end": end, "midi": midi, "string": string,
            "noteEvidence": 0.8, "onsetEvidence": onset}


def jams(notes, duration=3.0):
    return {"file_metadata": {"title": "semantic-fixture", "duration": duration},
            "annotations": [{"namespace": "note_midi", "annotation_metadata": {"data_source": str(string)},
                             "data": [{"time": item["start"], "duration": item["end"] - item["start"],
                                       "value": item["midi"], "confidence": None}
                                      for item in notes if item["string"] == string]}
                            for string in range(6)]}


def prediction(notes, duration=3.0):
    return {"engine": "chroma-v2", "duration": duration, "noteEventsVersion": 1,
            "noteEventsLimit": 24000, "noteEventsTruncated": False,
            "noteEventsCoverageEnd": duration, "noteEvents": notes}


def performance(notes, duration=3.0):
    return {"schemaVersion": 1, "duration": duration, "ticksPerBeat": 24,
            "tuningMidi": [40, 45, 50, 55, 59, 64],
            "rhythm": {"style": "undetermined", "complete": True},
            "projection": {"status": "ready", "range": {"start": 0, "end": duration},
                           "tempo": 120, "tab": {"version": 3, "tempo": 120, "notes": notes}}}


class NoteEvaluationSemantics(unittest.TestCase):
    def test_augmenting_path_recovers_match_a_nearest_greedy_choice_loses(self):
        reference = [note(1.0, 1.2), note(1.09, 1.29)]
        estimated = [note(1.05, 1.25), note(1.13, 1.33)]
        # First estimate is closer to reference 1, but only it can match reference 0.
        self.assertEqual(E.matching(reference, estimated), [(0, 0), (1, 1)])
        self.assertEqual(E.score_notes(reference, estimated)["onsetPitch"]["f1"], 1)

    def test_pitch_uses_fractional_midi_and_never_octave_or_pitch_class_credit(self):
        for reference_pitch, estimated_pitch, expected in [(60.49, 60, 1), (60.5, 60, 1),
                                                            (60.501, 60, 0), (60, 72, 0), (60, 61, 0)]:
            with self.subTest(reference_pitch=reference_pitch, estimated_pitch=estimated_pitch):
                result = E.score_notes([note(midi=reference_pitch)], [note(midi=estimated_pitch)])
                self.assertEqual(result["onsetPitch"]["matchedCount"], expected)

    def test_onset_tolerance_is_inclusive_and_no_alignment_is_fitted(self):
        for shift, matches in [(0.05, 1), (-0.05, 1), (0.05001, 0), (0.2, 0)]:
            with self.subTest(shift=shift):
                result = E.score_notes([note()], [note(1 + shift, 1.2 + shift)])
                self.assertEqual(result["onsetPitch"]["matchedCount"], matches)

    def test_offsets_are_an_independent_stricter_matching_and_errors_keep_sign(self):
        result = E.score_notes([note()], [note(1.01, 2)])
        self.assertEqual(result["onsetPitch"]["matchedCount"], 1)
        self.assertEqual(result["onsetPitchOffset"]["matchedCount"], 0)
        timing = result["timingOnOnsetPitchMatches"]
        self.assertAlmostEqual(timing["onset"]["meanSignedSeconds"], 0.01)
        self.assertAlmostEqual(timing["offset"]["meanSignedSeconds"], 0.8)
        self.assertAlmostEqual(timing["duration"]["meanSignedSeconds"], 0.79)
        for end, matches in [(2.2, 1), (2.20001, 0)]:
            with self.subTest(end=end):
                score = E.score_notes([note(1, 2)], [note(1, end)])
                self.assertEqual(score["onsetPitchOffset"]["matchedCount"], matches)

    def test_duplicate_predictions_and_string_unisons_keep_their_denominators(self):
        duplicate = E.score_notes([note()], [note(), note()])["onsetPitch"]
        self.assertEqual((duplicate["matchedCount"], duplicate["falsePositives"]), (1, 1))
        self.assertEqual(duplicate["precision"], 0.5)
        unisons = E.score_notes([note(string=3), note(string=4)], [note()])["onsetPitch"]
        self.assertEqual((unisons["referenceCount"], unisons["falseNegatives"]), (2, 1))
        self.assertEqual(unisons["recall"], 0.5)

    def test_zero_output_is_zero_recall_with_no_invented_timing_measurement(self):
        result = E.score_notes([note()], [])
        self.assertEqual(result["onsetPitch"]["precision"], 0)
        self.assertEqual(result["onsetPitch"]["recall"], 0)
        self.assertEqual(result["onsetPitch"]["f1"], 0)
        self.assertIsNone(result["timingOnOnsetPitchMatches"]["onset"]["meanSignedSeconds"])
        self.assertEqual(E.score_notes([], [note()])["onsetPitch"]["falsePositives"], 1)
        self.assertEqual(E.score_notes([], [])["onsetPitch"]["f1"], 0)

    def test_activity_only_notes_remain_in_primary_score_and_subsets_use_all_references(self):
        truth = jams([note(), note(2, 2.3, 64, 5)])
        estimated = prediction([note(onset=0), note(2, 2.3, 64, 5)])
        result = E.evaluate(truth, estimated)
        self.assertEqual(result["rawNotes"]["all"]["onsetPitch"]["recall"], 1)
        for subset in ("activityOnly", "confirmedAttacks"):
            self.assertEqual(result["rawNotes"][subset]["onsetPitch"]["referenceCount"], 2)
            self.assertEqual(result["rawNotes"][subset]["onsetPitch"]["recall"], 0.5)

    def test_reference_schema_uses_note_namespace_string_metadata_and_fractional_values(self):
        truth = jams([note(midi=60.14, string=4)])
        truth["annotations"].insert(0, {"namespace": "pitch_contour", "data": {"time": [1], "value": [1]}})
        notes, duration = E.reference_notes(truth)
        self.assertEqual((len(notes), notes[0]["midi"], notes[0]["string"], duration), (1, 60.14, 4, 3))
        for changed in (truth["annotations"][:-1], truth["annotations"] + [copy.deepcopy(truth["annotations"][1])]):
            with self.subTest(annotation_count=len(changed)), self.assertRaises(ValueError):
                E.reference_notes({**truth, "annotations": changed})

    def test_bad_times_numbers_and_duration_mismatch_fail_instead_of_being_dropped(self):
        for altered in ({"start": -0.1}, {"start": 1.2}, {"end": 4}, {"end": float("nan")},
                        {"midi": float("inf")}, {"midi": True}, {"noteEvidence": "0.8"}):
            with self.subTest(altered=altered), self.assertRaises(ValueError):
                E.prediction_notes(prediction([{**note(), **altered}]))
        with self.assertRaises(ValueError):
            E.evaluate(jams([note()]), prediction([note()], duration=4))
        bad_reference = jams([note()])
        bad_reference["annotations"][4]["data"][0]["duration"] = 0
        with self.assertRaises(ValueError):
            E.reference_notes(bad_reference)

    def test_truncated_coverage_does_not_trim_reference_notes(self):
        raw = prediction([note()])
        raw.update(noteEventsTruncated=True, noteEventsCoverageEnd=1.5)
        result = E.evaluate(jams([note(), note(2, 2.3)]), raw)
        self.assertEqual(result["rawNotes"]["all"]["onsetPitch"]["referenceCount"], 2)
        self.assertEqual(result["rawNotes"]["all"]["onsetPitch"]["recall"], 0.5)

    def test_tab_ticks_convert_to_source_seconds_and_alternate_string_is_separate(self):
        # C4 on G-string fret 5 sounds the same as C4 on B-string fret 1.
        output = performance([{"string": 3, "fret": 5, "tick": 48, "duration": 24}])
        notes, summary = E.projection_notes(output, 3)
        self.assertEqual((notes[0]["start"], notes[0]["end"], notes[0]["midi"]), (1, 1.5, 60))
        self.assertEqual(summary["tempo"], 120)
        result = E.evaluate(jams([note(1, 1.5, 60, 4)]), prediction([note(1, 1.5)]), output)
        score = result["projectedTab"]["scores"]
        self.assertEqual(score["onsetPitch"]["f1"], 1)
        self.assertEqual(score["stringPlacementDiagnostic"]["onsetPitchString"]["f1"], 0)
        self.assertIsNone(result["playingStyleDiagnostic"]["accuracy"])

    def test_unavailable_tab_scores_zero_with_the_same_reference_denominator(self):
        output = performance([])
        output["projection"] = {"status": "unavailable", "reason": "noPlayableNotes"}
        result = E.evaluate(jams([note()]), prediction([note()]), output)
        self.assertEqual(result["projectedTab"]["scores"]["onsetPitch"]["referenceCount"], 1)
        self.assertEqual(result["projectedTab"]["scores"]["onsetPitch"]["f1"], 0)
        self.assertEqual(result["projectedTab"]["reason"], "noPlayableNotes")

    def test_cropped_or_invalid_tab_output_cannot_improve_the_score(self):
        for change in ("cropped", "negative", "badString", "tuning"):
            output = performance([{"string": 4, "fret": 1, "tick": 48, "duration": 24}])
            if change == "cropped":
                output["projection"]["range"]["start"] = 1
            elif change == "negative":
                output["projection"]["tab"]["notes"][0]["duration"] = -1
            elif change == "badString":
                output["projection"]["tab"]["notes"][0]["string"] = 6
            else:
                output["tuningMidi"][0] = 38
            with self.subTest(change=change), self.assertRaises(ValueError):
                E.projection_notes(output, 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
