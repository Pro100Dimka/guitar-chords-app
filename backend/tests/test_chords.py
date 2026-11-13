import numpy as np
import pytest

from freetune_analysis.chords import equal_prior_path


def test_recording_may_start_inside_a_chord_without_forced_n_frame():
    observations = np.array([[-9.0, -0.1], [-9.0, -0.1], [-9.0, -0.1]])
    assert equal_prior_path(observations, [1, 1, 1], 30.0, (15, 45, 100)).tolist() == [1, 1, 1]


def test_silent_start_remains_n_when_observations_support_it():
    observations = np.array([[-0.1, -9.0], [-0.1, -9.0], [-0.1, -9.0]])
    assert equal_prior_path(observations, [1, 1, 1], 30.0, (15, 45, 100)).tolist() == [0, 0, 0]


def test_transition_penalty_and_beat_restriction_still_control_changes():
    observations = np.array([[0.0, -30.0], [-20.0, 0.0], [-20.0, 0.0]])
    assert equal_prior_path(observations, [1, 1, 1], 10.0, (15, 45, 100)).tolist() == [0, 1, 1]
    assert equal_prior_path(observations, [1, 0, 1], 10.0, (15, 45, 100)).tolist() == [0, 0, 1]


@pytest.mark.parametrize("values,changes", [([], []), ([[0.0]], []), ([[float("nan")]], [1])])
def test_invalid_observations_do_not_create_chord_labels(values, changes):
    with pytest.raises(ValueError):
        equal_prior_path(values, changes, 30, (15, 45, 100))
