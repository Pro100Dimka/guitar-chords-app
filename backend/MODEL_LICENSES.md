# Model and dependency provenance

Checked against the upstream repositories/model cards on 2026-11-12. Preserve
these notices when redistributing the backend or model files. The Android APK
does not bundle the Python runtime, FFmpeg, or ASR/chord checkpoints.

| Component | Pinned artifact | Code / weight terms | Primary source |
|---|---|---|---|
| Whisper | OpenAI multilingual Whisper family | Upstream explicitly states **both code and model weights are MIT** | https://github.com/openai/whisper#license |
| Faster Whisper | `faster-whisper==1.2.1` | MIT code; inference engine does not change original model license | https://github.com/SYSTRAN/faster-whisper/tree/v1.2.1 |
| CTranslate2 | `ctranslate2==4.6.0` | MIT | https://github.com/OpenNMT/CTranslate2/blob/master/LICENSE |
| Small checkpoint | `Systran/faster-whisper-small` at `536b0662742c02347bc0e980a01041f333bce120` | Model card MIT; FP16-converted OpenAI small weights, loaded as INT8 | https://huggingface.co/Systran/faster-whisper-small |
| Turbo checkpoint | `dropbox-dash/faster-whisper-large-v3-turbo` at `0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf` | Model card MIT; converted OpenAI large-v3-turbo. Former Mobius Labs URL redirects here | https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo |
| LV-Chordia | `lv-chordia==1.1.0`, publisher commit `990f00177029f043be24478f867005a52c6c304e` | MIT repository license includes bundled original pretrained checkpoints; no separate noncommercial checkpoint license found in either upstream repository | https://github.com/music-x-lab/ISMIR2019-Large-Vocabulary-Chord-Recognition and https://pypi.org/project/lv-chordia/1.1.0/ |
| Word alignment | Faster Whisper cross-attention DTW | Same MIT ASR checkpoint; no separately downloaded language aligner | https://github.com/SYSTRAN/faster-whisper#word-level-timestamps |
| Librosa | `librosa==0.11.0` | ISC code; no model weights | https://github.com/librosa/librosa/blob/main/LICENSE.md |
| PyTorch | `torch==2.7.1`, CPU build used for verification | BSD-style code license; distribution includes additional bundled notices | https://github.com/pytorch/pytorch/blob/v2.7.1/LICENSE |
| FFmpeg | Host installation | LGPL 2.1+ or GPL depending on configured build; externally invoked executable | https://ffmpeg.org/legal.html |

The released LV-Chordia wheel's SHA-256 is
`292241f03e1029e6739ee7a2a91fbe348c25c97b8b3641db76cbef9f9dee0cb0`.
The five bundled checkpoint digests are pinned and verified in `pipeline.py`.
Whisper setup records the downloaded immutable revision and SHA-256 digests in
`freetune-model.json`, which runtime readiness checks verify.

The full MIT notices for Whisper, Faster Whisper, and Music X Lab are retained
in `licenses/`. Installed Python wheels also carry their own notices. The MIT
notice grants permission for use, modification and distribution subject to
retaining its copyright/permission text; these models do not require a paid
service or application subscription.

## Selection and exclusions

The implementation uses a self-hosted computer because it can run the actual
multilingual models while keeping the Android UI responsive. This does **not**
prove that on-device analysis is impossible. Whisper.cpp supports Android, and
its own example recommends tiny/base for phones; its published table lists
small at 466 MiB on disk/~852 MB runtime, medium at 1.5 GiB/~2.1 GB, and large at
2.9 GiB/~3.9 GB. Those are project reference values, not our measurements on a
phone. Source: https://github.com/ggml-org/whisper.cpp#memory-usage and
https://github.com/ggml-org/whisper.cpp/tree/master/examples/whisper.android .

No real Android phone was available to validate native singing ASR speed and
memory. Actual delivered measurements must distinguish the Linux server,
Android emulator, and any future physical-device runs.

Mandatory Demucs preprocessing was deliberately omitted. The Jam-ALT paper
reports that adding Demucs worsened Whisper v3 aggregate WER in that experiment
(35.5% to 48.0%; known language 32.6% to 46.6%). These are external benchmark
results, not this app's scores. They show that separation cannot be assumed to
improve singing recognition. Source, Table 1:
https://arxiv.org/html/2408.06370v1 . No Demucs weights are distributed here.

Madmom's pretrained chord models were excluded because they are
**CC BY-NC-SA 4.0**, unlike its permissive code license:
https://github.com/CPJKU/madmom_models#license . The selected LV-Chordia model
avoids that noncommercial restriction. No inference output is generated using
untrained/random checkpoint fallbacks.

## Evaluation recordings

JamendoLyrics dataset code and annotations carry their published notices;
recordings/lyrics have **individual Creative Commons licenses**, as the dataset
LICENSE explicitly explains. Sources:

- https://huggingface.co/datasets/jamendolyrics/jamendolyrics/blob/main/LICENSE
- https://huggingface.co/datasets/jamendolyrics/jamendolyrics/blob/main/JamendoLyrics.csv
- https://huggingface.co/datasets/jamendolyrics/jam-alt
- https://audioshake.github.io/jam-alt/

The download manifest retains individual licenses and original track URLs.
Evaluation data are not product assets. CC-NC/ND recordings and their full
transcripts are not included in the repository's shipped validation report.
The **Cortéz — Feel (Stripped)** example is sourced from
https://www.jamendo.com/track/1481500/feel-stripped . The original downloaded MP3's
ID3 `copyright` field specifies **CC BY 3.0**:
https://creativecommons.org/licenses/by/3.0/ . Its artist tag is `Cortéz`, album
`Stripped - EP`, date `2017`. This embedded notice supplies the precise version
that the dataset abbreviates as CC BY. Redistributed demo assets must credit the
artist, retain the license/source, and describe any excerpting or audio
conversion. Recognized model output is not a human-corrected transcript.
