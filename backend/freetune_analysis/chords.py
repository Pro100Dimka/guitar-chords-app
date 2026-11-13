"""LV-Chordia inference with evidence-based starting harmony.

LV-Chordia 1.1.0's HMM initializes every state except N to negative infinity.
That forces a 20 ms N interval even when the recording starts inside a chord.
Use equal initial priors; observations still choose N on silence. The neural
ensemble, chord dictionary, transition penalties and original frame grid are
unchanged. The recurrence follows LV-Chordia's MIT-licensed XHMMDecoder.
"""

from pathlib import Path


def equal_prior_path(observations, changes, difference_penalty, beat_penalties):
    """Return the most likely state sequence without forcing initial silence."""
    import numpy as np
    values = np.asarray(observations)
    if values.ndim != 2 or not values.shape[0] or not values.shape[1]:
        raise ValueError("chord_observations_empty")
    if len(changes) != len(values) or np.isnan(values).any():
        raise ValueError("chord_observations_invalid")
    count, states = values.shape
    previous = values[0].copy()
    back = np.empty((count, states), dtype=np.int32)
    back[0] = -1
    state_ids = np.arange(states)
    for frame in range(1, count):
        best = int(np.argmax(previous))
        change = int(changes[frame])
        if change:
            penalty = difference_penalty if change == 1 else beat_penalties[change - 2]
            switching = previous[best] - penalty
            staying = previous > switching
            back[frame] = np.where(staying, state_ids, best)
            previous = np.maximum(previous, switching) + values[frame]
        else:
            back[frame] = state_ids
            previous = previous + values[frame]
    path = np.empty(count, dtype=np.int32)
    path[-1] = int(np.argmax(previous))
    for frame in range(count - 2, -1, -1):
        path[frame] = back[frame + 1, path[frame + 1]]
    return path


def recognize_harmony(audio: Path, observer=None):
    """Run the pinned five-model ensemble on an owned local decoded WAV.

    The optional observer is evaluation-only: receives legacy and corrected
    HMM labels produced from the very same neural observations, not a second
    inference. Audio paths, reference harmony and source lyrics never enter a
    learned model as text.
    """
    import importlib.resources
    import numpy as np
    from lv_chordia.chordnet_ismir_naive import ChordNet
    from lv_chordia.chord_recognition import MODEL_NAMES
    from lv_chordia.extractors.cqt import CQTV2
    from lv_chordia.extractors.xhmm_ismir import XHMMDecoder
    from lv_chordia.mir import DataEntry, io
    from lv_chordia.mir.nn.train import NetworkInterface
    from lv_chordia.settings import DEFAULT_HOP_LENGTH, DEFAULT_SR

    class EqualPriorDecoder(XHMMDecoder):
        def decode(self, probabilities, beats, triad_restriction=None):
            names, observations = self.get_chord_tag_obs(probabilities, triad_restriction)
            ids = equal_prior_path(observations, beats, self.diff_trans_penalty,
                                   self.beat_trans_penalty)
            return [names[index] for index in ids]

    resource = importlib.resources.files("lv_chordia.data").joinpath("submission_chord_list.txt")
    with importlib.resources.as_file(resource) as template:
        decoder = EqualPriorDecoder(template_file=str(template))
        legacy_decoder = XHMMDecoder(template_file=str(template)) if observer else None
    entry = DataEntry()
    entry.prop.set("sr", DEFAULT_SR)
    entry.prop.set("hop_length", DEFAULT_HOP_LENGTH)
    entry.append_file(str(audio), io.MusicIO, "music")
    entry.append_extractor(CQTV2, "cqt")
    probabilities = []
    for model_name in MODEL_NAMES:
        network = NetworkInterface(ChordNet(None), model_name, load_checkpoint=False)
        probabilities.append(network.inference(entry.cqt))
    ensemble = [np.mean([result[index] for result in probabilities], axis=0)
                for index in range(len(probabilities[0]))]
    corrected = decoder.decode_to_chordlab(entry, ensemble, False)

    def annotations(segments):
        return [{"start_time": round(float(start), 2), "end_time": round(float(end), 2),
                 "chord": str(label)} for start, end, label in segments]

    result = annotations(corrected)
    if observer:
        observer({"legacy": annotations(legacy_decoder.decode_to_chordlab(entry, ensemble, False)),
                  "equalPrior": result})
    return result
