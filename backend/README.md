# FreeTune audio analysis server

This is the executable analysis service used by **Add audio** in FreeTune. It runs
Whisper and a pretrained chord-recognition ensemble on your own computer. It does
not call a paid API, look up another recording, generate replacement lyrics with
an LLM, or upload audio to a model provider.

The Android app keeps the original recording and its editable analysis in its
own library. Audio is sent to the server address the user selects, after the app's
explicit disclosure. A computer on the same Wi-Fi network is sufficient. Reading,
editing, and playing an already saved result do not require that computer.

## Install on Windows

Install **Python 3.12 (64-bit)** and FFmpeg (both `ffmpeg` and `ffprobe` must be on
PATH). In PowerShell, from this `backend` directory:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python -m pip install torch==2.7.1 --index-url https://download.pytorch.org/whl/cpu
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m freetune_analysis.setup_models --model small
$env:FREETUNE_API_TOKEN = 'choose-a-long-private-token'
.\.venv\Scripts\python -m freetune_analysis --host 0.0.0.0 --port 8765
```

In the app, enter `http://YOUR-PC-LAN-IP:8765` and the same token. Allow TCP 8765
on the computer's private-network firewall. `localhost` on a physical phone
means the phone itself, not the computer. A Wi-Fi connection does not require
uploading the audio to the public Internet. The HTTP LAN option sends audio
unencrypted on that LAN; use a trusted private network or an HTTPS reverse proxy.

For USB debugging, `adb reverse tcp:8765 tcp:8765` allows the app to use
`http://127.0.0.1:8765`. Localhost-only serving does not require a token:

```powershell
.\.venv\Scripts\python -m freetune_analysis --port 8765
```

## Install on Linux

Install Python 3.12, its venv module, and FFmpeg with your distribution's package
manager, then:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install torch==2.7.1 --index-url https://download.pytorch.org/whl/cpu
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m freetune_analysis.setup_models --model small
export FREETUNE_API_TOKEN='choose-a-long-private-token'
.venv/bin/python -m freetune_analysis --host 0.0.0.0 --port 8765
```

The CPU installation is intentional: it avoids downloading CUDA libraries on a
computer that will not use them. GPU operation is configurable with
`FREETUNE_DEVICE=cuda` and `FREETUNE_COMPUTE_TYPE=float16`, but requires a CUDA
PyTorch installation and CTranslate2-compatible CUDA/cuDNN libraries. GPU timings
have not been measured here; the verified baseline is Linux x86-64 CPU.

### Optional Docker installation

```bash
docker build -t freetune-analysis .
docker run --rm -v freetune-analysis-data:/data freetune-analysis python -m freetune_analysis.setup_models --model small
docker run --rm -p 8765:8765 -v freetune-analysis-data:/data -e FREETUNE_API_TOKEN='choose-a-long-private-token' freetune-analysis
```

The Docker recipe is provided for reproducibility; do not interpret it as a
separately measured Docker deployment. Native Python was used for validation.

## Models and honest limits

| Task | Actual implementation | Download / license |
|---|---|---|
| Singing transcription | Multilingual Whisper small, CTranslate2 INT8 CPU | 483,546,902-byte weights, about 486 MB with tokenizer/config; MIT code and weights |
| Optional larger ASR | Whisper large-v3-turbo, CTranslate2 | About 1.62 GB; MIT code and weights |
| Word alignment | Whisper cross-attention + dynamic time warping via `word_timestamps=True` | Uses the same ASR weights; no separate unlicensed aligner |
| Harmonic recognition | LV-Chordia 1.1.0: five pretrained CQT neural networks + HMM | About 28 MB of checkpoints, included by the dependency; MIT |
| Audio decoding | Installed FFmpeg, original timeline retained | FFmpeg build's LGPL/GPL terms; not linked into the Android app |

The precise model repositories/revisions and license sources are in
[MODEL_LICENSES.md](MODEL_LICENSES.md). Model download is an explicit setup step.
Serving requests never downloads weights. The setup utility records SHA-256
digests; model readiness checks them. All five chord checkpoint digests are also
pinned. A missing checkpoint is an error, never a randomly initialized model.

Select the optional larger model explicitly:

```bash
.venv/bin/python -m freetune_analysis.setup_models --model turbo
export FREETUNE_WHISPER_MODEL=turbo
.venv/bin/python -m freetune_analysis --port 8765
```

Use the PowerShell equivalents on Windows. `small` is the default for the lower
memory footprint. The real quality/performance measurements and remaining
coverage gaps are recorded with the delivered validation results. Speech
benchmarks from model authors are not Android or singing measurements.

### Measured model comparison

The same 240.562-second **Cortéz — Feel (Stripped)** recording was uploaded to the
actual HTTP service with each model, using CPU INT8 and four inference threads
on the shared Linux x86-64 workspace. The native build was stopped for these
two runs. Reference text was human-revised Jam-ALT, used only after inference.

| Model | Upload-to-result wall time | Peak worker + descendants RSS | Word error rate | Exact words aligned to timing reference | Start / end MAE on those matched words |
|---|---:|---:|---:|---:|---:|
| Small (default) | 49.242 s | 1803.95 MiB | 17.98% (64 / 356) | 295 / 355 | 0.237 / 0.173 s |
| Large-v3-turbo | 96.949 s | 2500.66 MiB | 13.76% (49 / 356) | 310 / 355 | 0.505 / 0.428 s |

The timed-word subsets differ, so their MAEs are not a paired comparison on
identical words. The larger model reduced text errors on this recording while
taking almost twice as long and using more memory. Small remains the CPU
default; turbo is an explicit alternative. One song does not establish a
general quality ranking or Ukrainian/Russian accuracy. Installed top-level
model files measured 486,214,945 bytes for small and 1,621,668,118 bytes for turbo.

The full small-model run completed **20 English songs**, totaling 4333.043 seconds
of audio in 1266.881 seconds of observed wall time. Aggregate WER was **36.19%**
(2257 errors / 6237 reference words). Start/end MAE was 0.380/0.351 seconds over
3853 exact word matches, covering 67.68% of the separate timing reference. These
errors require substantial manual correction on some songs. The maximum
observed RSS was 1810.87 MiB. Early corpus runs shared CPU/memory with other
project work; these are observed server measurements, not controlled Android
benchmarks. The app's actual result validator accepted all 20 stored results,
with original/decoded duration differences no larger than 0.053 seconds.

Two additional real recordings exercised Ukrainian and Russian execution. The
125.24-second Ukrainian classical vocal completed in 32.759 seconds, with six
lyric lines and 54 chord intervals. The 123.525-second historical Russian
recording completed in 66.687 seconds after the targeted caption correction,
with two lyric lines and six chord intervals. Both passed the actual client
result validator. Their recognized text contains substantial errors or
omissions; they have no verified performance transcript, word timing, or chord
reference, so **no Ukrainian/Russian accuracy score is claimed**. A known ASR
caption was removed from the Russian result; the remaining lyrics and their
times exactly matched the preceding run. This was a formatting correction,
without human listening confirmation of that audio interval.

The [validation report](../docs/validation/README.md) records raw measurements,
the separate GuitarSet chord evaluation, and the remaining validation gaps.

**Automatic lyrics and chord labels require review.** Singing is substantially
harder than ordinary speech. Distorted vocals, backing vocals, rap, unusual
pronunciation, and long held vowels can yield wrong or missing words and
imprecise word endings. Low-confidence words are shown as `…`, with uncertainty
flags. Silence/no-speech checks reduce hallucinations but cannot guarantee their
absence on every instrumental arrangement. No ground-truth lyrics are supplied
to inference. A pure instrumental track may legitimately have an empty lyric
list and a `no_lyrics` warning.

Recognizable non-lyric ASR captions such as uppercase `СПОКОЙНАЯ МЕЛОДИЯ` or
bracketed `[MUSIC]` are omitted with `non_lyric_caption_omitted`. This narrow
formatting rule does not remove ordinary lyrics containing “music” or arbitrary
uppercase lyrics. It is not an instrumental/vocal classifier and cannot
guarantee the absence of other hallucinations. The recorded English corpus was
audited against this final-line filter: it changes none of its 20 results.

No words are redistributed evenly over a line. Invalid overlapping word spans
are discarded while the text and coarse line interval are preserved and marked
uncertain. Chord times stay at the recognizer's actual changes; there is no
one-bar-per-chord conversion. `N` means no chord, `?` means unknown. Harte labels
are converted only when equivalent (`C:min7` → `Cm7`, `C:maj/3` → `C/E`). Unsupported
extensions retain their original label instead of being silently simplified to
a fingering. The model does not reconstruct strumming, picking, or tablature.

## HTTP contract

All times are floating-point **seconds from the start of the original audio**.
Do not add an intro offset, infer beats from array indexes, or normalize interval
lengths. The original file is decoded to untrimmed mono PCM; the ASR resample does
not concatenate VAD regions, stretch time, or remove silence.

If a token is set, send `Authorization: Bearer <token>` for every `/v1/` request.
The health check is public and contains no recordings or tokens.

| Method | Path | Behavior |
|---|---|---|
| GET | `/health` | `{status:"ok", ready, models, limits, authenticationRequired}` |
| POST | `/v1/jobs` | Multipart fields `file`, `language`, `idempotency_key`, `audio_sha256`; returns HTTP 202 and a job |
| GET | `/v1/jobs/{id}` | Poll persistent state and any useful partial result |
| DELETE | `/v1/jobs/{id}` | Cancel queued/running work and delete server-side audio; for finished work acknowledge/clean up while preserving its result |

`language` is `auto`, `uk`, `ru`, or `en`. SHA-256 is calculated over the exact
uploaded original file bytes. A repeated key with the same audio and language
reuses the existing job. A key reused for different bytes/language returns 409.
A cancelled/failed/interrupted job can be safely retried with the same key and
file. A completed/partial result remains idempotent; an intentional new analysis
uses a new key. The app protects its separate edited revision before that action.

```json
{
  "id": "server-generated-id",
  "status": "completed",
  "stage": "done",
  "progress": 1,
  "audio_sha256": "sha256-of-original-bytes",
  "idempotency_key": "client-analysis-generation",
  "error": null,
  "result": {
    "version": 1,
    "duration": 240.56,
    "language": "en",
    "lyrics": [],
    "chords": [],
    "warnings": [],
    "model": {"lyrics": "model-id", "alignment": "method", "chords": "model-id"},
    "metrics": {"elapsedSeconds": 1, "peakRssMb": 1, "device": "cpu/Linux/x86_64"}
  }
}
```

The numbers in this schema example illustrate types, not a benchmark result.
Lyric rows are `{start,end,text,words:[{start,end,text,confidence,uncertain}],uncertain}`;
chord rows are `{start,end,label,uncertain}`. `confidence` is ASR probability, not a
guarantee of correctness. The chord model's API does not expose calibrated
confidence, so the service does not invent a percentage.

Statuses: `queued`, `running`, `completed`, `partial`, `failed`, `cancelled`,
`interrupted`. Stages: `queued`, `starting`, `decoding`, `chords`, `lyrics`, `done`,
`failed`, `cancelled`, `interrupted`. Progress is 0–1. Result language can be
`null` if automatic language detection finds an unsupported language.

Useful warnings/errors include `no_lyrics`, `lyrics_unreliable`,
`word_timing_unreliable`, `non_lyric_caption_omitted`, `lyrics_model_not_installed`, `chord_model_not_installed`,
`lyrics_failed`, `chords_failed`, `invalid_audio`, `audio_too_long`,
`audio_hash_mismatch`, `memory_limit_exceeded`, `analysis_timeout`, `worker_failed`,
`server_restarted`. If one engine fails, the other's actual result is retained
with `partial` status. Engine processes can be terminated during inference.

## Reliability, storage and resources

- One worker process runs at a time per server. A filesystem lock prevents two
  servers from corrupting the same data directory. Do not run multiple uvicorn
  workers against it.
- Default limits match Android import: 256 MiB compressed file, 30 minutes of
  audio, eight queued/running jobs, 4 GiB sampled worker RSS, and one hour per job.
  Invalid files are checked by FFprobe/FFmpeg, not just their extension.
- Uploaded and decoded audio are deleted after completion, failure or
  cancellation. Job state/results remain in `data/jobs.sqlite3` for 24 hours;
  they are automatically expired. On startup, unfinished jobs become
  `interrupted`; temporary files are removed, and the phone can re-upload its
  stable local copy with the same key.
- Partial results are checkpointed during processing. Cancellation wins over
  late worker output; retry waits until the old process relinquishes its files.
  An independent process watches the server's PID and creation time, so a hard
  server crash also stops native model calls and FFmpeg descendants. The guard
  does not depend on the model thread releasing Python's GIL.
- `peakRssMb` is MiB. The supervisor samples the sum of worker + descendant RSS
  every 250 ms. On POSIX it additionally uses the worker's `ru_maxrss` high-water
  mark. It excludes the separate HTTP server, OS caches, and GPU VRAM. It is not
  an Android memory measurement. Elapsed time is worker processing time; the
  benchmark additionally reports upload/poll wall time.

Configuration: `FREETUNE_DATA_DIR`, `FREETUNE_API_TOKEN`,
`FREETUNE_WHISPER_MODEL` (`small`/`turbo`), `FREETUNE_WHISPER_PATH`,
`FREETUNE_DEVICE` (`cpu`/`cuda`), `FREETUNE_COMPUTE_TYPE`, `FREETUNE_CPU_THREADS`,
`FREETUNE_MAX_UPLOAD_MB`, `FREETUNE_MAX_DURATION_SECONDS`, `FREETUNE_MAX_RSS_MB`,
`FREETUNE_MAX_JOB_SECONDS`, `FREETUNE_RETENTION_HOURS`, `FREETUNE_MAX_QUEUED_JOBS`.

## Verification and reproducing measurements

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q tests
.venv/bin/python -m freetune_analysis.download_evaluation --count 20
.venv/bin/python -m freetune_analysis.benchmark data/evaluation/jamendo/manifest.json --output data/evaluation/report.json
```

If interrupted, repeat the benchmark with `--resume`; completed recordings are
reused only after verifying their original audio hash and chosen model.

The benchmark starts a real localhost HTTP server in an isolated job directory,
uploads each original recording, polls its real inference result, verifies its
hash/key, persists metrics, and acknowledges cleanup. The reference combines
**human-revised Jam-ALT v1.4.0 lyrics** with **human JamendoLyrics word timestamps**.
References are used only for scoring after inference. The included corpus has
20 full English recordings, not Ukrainian/Russian recordings. Do not describe
those results as a three-language validation.

WER counts low-confidence `…` markers as errors. Word-boundary mean absolute
error uses only exact aligned text matches and must be read with its coverage;
it is not an accuracy claim for unrecognized words. Human chord annotations are
not available in this song corpus, so chord accuracy is `null`. Separately
provided GuitarSet evaluation measures instrument excerpts, not sung songs.

The corpus downloader records each recording's source and individual CC license.
Restricted CC-NC/ND recordings and their full transcripts are kept in ignored
local evaluation data, not shipped with the product. `--only-cc-by` selects the
two English CC-BY tracks for a redistributable demonstration. Keep attribution
and the applicable recording license with any demo you share.

The delivered example uses **Cortéz — Feel (Stripped)**, from *Stripped - EP*
(2017), under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), as recorded
in the original MP3's embedded copyright notice. Its source is
https://www.jamendo.com/track/1481500/feel-stripped . Demo excerpts and audio
conversions are identified in their accompanying credits; model output remains
an uncorrected automatic analysis.
