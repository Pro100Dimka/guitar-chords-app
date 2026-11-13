# FreeTune analysis service — operator documentation

FreeTune's ordinary Android flow uses a **developer-operated HTTPS service**. A
person selects their original MP3, WAV or M4A, reads the upload disclosure, and
starts analysis. The app obtains installation access automatically. Ordinary use
does not ask for an IP address, token, Python installation or a personal server.
The original recording and editable results remain in the app's local library.

**There is currently no deployed public service URL.** The release endpoint must
remain empty until the developer supplies an operating service; the app presents
analysis as unavailable in that state. These files do not provision a domain,
server, paid resource or APK. No physical Android validation is implied.

Inference uses local Whisper and LV-Chordia weights. It does not call a paid
inference API, search for another performance, synthesize replacement lyrics, or
send recordings to a model provider. The software is free to use; the developer
still needs existing hardware, network access, storage and operational capacity.

## Current model profile and evidence

`small`, CPU INT8, four threads, **one worker** remains the deployment default.
The previous turbo candidate lowered English WER but failed instrumental and
repetition controls. It is not an accepted quality profile. See
[the recovery checkpoint](../docs/validation/quality-v2-recovery-status.md) and its
[machine-readable observations](../docs/validation/quality-v2-observed-checkpoint.json).
Subsequent experiments must identify their exact code, model and examined data.

The current timing adapter is `native-span-fallback-v1`: supported words retain
their actual native DTW intervals; connected ambiguous intervals become explicit
coarse fragments. The same audio, words and source timeline are retained. This
fix restores much of the whole-line fallback's lost word coverage, but current
EN20 WER remains 37.69% versus the historical 36.19%. See the
[complete final comparison](../docs/validation/quality-v3-summary.md), including
same-native controls, coverage loss, rejected alternatives and unmeasured areas.

Model inference completing successfully is not evidence that every word, chord
or timing is correct. Approximate line timing must remain visibly uncertain;
word confidence is not calibrated transcription accuracy. English human lyric
and timing references do not establish Ukrainian/Russian accuracy. Instrumental
GuitarSet chord results do not establish chord accuracy for full vocal songs.

The model repositories, revisions, checkpoint hashes and licenses are documented
in [MODEL_LICENSES.md](MODEL_LICENSES.md). The default Whisper small checkpoint is
about 486 MB; turbo is about 1.62 GB. LV-Chordia uses five pretrained checkpoint
files (about 28 MB), never random replacement weights. Model downloads are an
explicit operator setup step. Serving requests uses offline model loading.

## Shared service contract

Set `FREETUNE_SERVICE_MODE=shared` for the shared service. It does not accept a
single common `FREETUNE_API_TOKEN`.

| Route | Meaning |
|---|---|
| `GET /health` | Public readiness, model names, service mode, authentication, limits and privacy disclosure |
| `POST /v1/installations` | No authorization or body required; creates installation access |
| `POST /v1/jobs` | Authenticated multipart upload; returns the existing or newly queued job, HTTP 202 |
| `GET /v1/jobs/{id}` | Authenticated owner-only status/result; another installation receives 404 |
| `DELETE /v1/jobs/{id}` | Cancels active work and removes its audio; a completed result remains retrievable |
| `DELETE /v1/job-requests/{idempotency_key}` | Records an owner-only cancellation even when an upload response was lost or the upload has not committed |

Registration returns `{installationId, token, expiresAt}`. `token` is `ft1_`
followed by 64 lowercase hexadecimal characters from 256 random bits. `expiresAt`
is Unix epoch **seconds**, 90 days after issuance. Only a SHA-256 hash is stored
on the server. Send `Authorization: Bearer <token>` on job and cancellation
requests. An expired or invalid credential returns 401. Installation access is
anonymous access for this device, not proof of a person's identity.

Upload fields are `file`, `language` (`auto`, `uk`, `ru`, `en`),
`idempotency_key` (1–128 ASCII letters, digits, `_ . : -`) and `audio_sha256`
(64 hexadecimal characters). `language` defaults to `auto` for legacy private
clients. The hash binds a job to the actual original bytes. Idempotency is unique
within an installation. Repeating the same key and matching input returns the
same job; changing the input or language returns 409. Failed/interrupted jobs
can be re-uploaded after their original audio has been removed. A request key
cancelled through `/v1/job-requests/…` cannot be re-enqueued for 24 hours.

A job retains the existing `id`, `status`, `stage`, `progress`, `error`,
`audio_sha256`, `idempotency_key` and `result` fields. `queuePosition` is one-based
for queued work and zero otherwise. States are `queued`, `running`, `completed`,
`partial`, `failed`, `cancelled`, and `interrupted`. Progress is 0–1. A useful
result from one analyzer survives the other's failure with `partial` status.

Cancellation by key returns HTTP 200 with
`{cancellationRecorded:true,idempotency_key,jobId,jobStatus}`. The last two fields
are null when the upload has not committed. The durable cancellation is written
before lookup; submission checks it in the same SQLite transaction as ownership
and quotas, so late arrival cannot restart cancelled work. Cancellation records
are bounded to 128 per installation and 8192 globally, expire after 24 hours, and
repeated cancellation of the same key consumes no extra record. A completed job
may still report `completed`: its existing result is retained while future
submission under that cancelled key is blocked.

429 responses and temporary readiness 503 responses include `Retry-After`.
Clients must respect it. Useful limit codes include `installation_queue_full`,
`installation_daily_limit`, `network_daily_limit`, `registration_rate_limited`,
`rate_limit_exceeded`, `installation_upload_in_progress`,
`upload_capacity_exceeded`, `queue_full` and `cancellation_capacity_exceeded`.
`storage_limit_exceeded` is 507. `job_request_cancelled`,
`audio_cleanup_pending` and `job_still_cancelling` are 409. Do not silently change
an idempotency key to evade a quota or repeat a cancelled action.

## Privacy, capacity and retention

| Shared default | Limit or behavior |
|---|---|
| Concurrent model workers | 1 per service data directory |
| Queued/running jobs | 8 globally, 2 per installation |
| New processing attempts | 20 per installation and 60 per network per UTC day |
| Installation registration | 5 per network per UTC day, 100 globally per UTC hour |
| API requests | 120 per installation and network per UTC minute |
| Cancellation | Separate 30 requests per installation and network per UTC minute |
| Concurrent HTTP handlers | 32 ordinary handlers; 4 additional cancellation handlers |
| Concurrent uploads | 2 globally, 1 per installation; admitted before reading the body |
| Original file | 256 MiB; WAV, MP3 or M4A only |
| Recording length | 30 minutes; checked with the real decoder, not trusted container metadata alone |
| Upload deadline | 300 seconds; streamed size and multipart field/file counts are bounded |
| Audio working storage | 2 GiB reserved across pending uploads and jobs; includes copy/spool and decoded-audio allowance |
| Worker resource limits | 4 GiB sampled worker/descendant RSS, one hour per job |
| Original and decoded audio | Deleted after completion, failure, cancellation or restart recovery |
| Results and cancellation records | 24 hours after completion/cancellation; acknowledging a result does not extend retention |
| Installation access | 90 days |

Audio working storage excludes read-only model weights and reusable model caches.
Leave additional host space for SQLite, system software and model/cache data.
The container also has a 5 GiB hard memory limit for the API, worker and temporary
allocation overhead. Sampled RSS is not a hard per-process allocator limit and
is not Android RAM usage.

SQLite stores ownership, hashed access, quotas and cancellation records across
restarts. The network quota uses a keyed HMAC of the socket client address; raw IP
addresses are not written into its quota tables. People sharing one public
network share that network's limit. The HMAC key is created once and retained in
SQLite. Do not delete the database to reset quotas on routine restarts.

A known proxy is trusted only at an **exact configured IP**, and only the
`X-FreeTune-Client-IP` header that our Caddy replaces from its actual socket peer
is used. Uvicorn proxy-header interpretation is disabled. Arbitrary
`X-Forwarded-For` and `Forwarded` headers never change the quota identity. Adding
another CDN or load balancer requires a deliberate ingress design update; simply
trusting its forwarded headers is not supported by this template.

Shared jobs do not retain original filenames. The API disables access logs, and
worker stdout/stderr are discarded so model output and decoder exceptions cannot
become raw-content logs. Caddy's request/access error logs are excluded. The
operator can observe structured status/error codes without retaining recordings
in logs. Do not add request-body, multipart or authorization-header logging.

Cleanup runs in a separate maintenance task even while a worker is busy. If
filesystem deletion fails, the job row and its storage/active-slot reservation
remain, cleanup is retried, and retry cannot overwrite the retained source.
Completed-result DELETE is acknowledgement plus audio cleanup, not immediate
result erasure. Retention expiry removes its row only after cleanup succeeds.
Expired result content is cleared from the API/database at the retention limit
even if failed audio deletion requires retaining the internal cleanup row and
its quota reservation. Once the worker is inactive, cleanup separately unlinks
its result-bearing `state.json` and `state.tmp` before deleting the audio
directory. If the filesystem also prevents those unlinks, residual worker files
remain pending cleanup and are retried; the 24-hour API expiry is not a guarantee
of physical deletion from an unavailable or read-only filesystem.
Restarts interrupt unfinished jobs and remove their audio before a re-upload.

## Developer deployment on existing infrastructure

The supplied [deployment template](deploy/compose.yaml) has a non-root analysis
container and a non-root Caddy container. Only Caddy publishes ports. The analysis
container has an internal Docker network and no outgoing Internet route. The
model volume is read-only at runtime; Numba, matplotlib and model caches have a
separate writable volume. A one-shot setup profile downloads weights before
serving. Caddy needs Internet access for certificate issuance and renewal.

Requirements: an existing Linux host with Docker Compose, capacity for the limits
above, an existing domain whose DNS points to it, and inbound TCP 80/443. This
repository does not create or pay for those resources.

From `backend/deploy`:

```bash
cp .env.example .env
# Edit .env: set the developer's existing domain and certificate contact email.
docker compose config --quiet
docker compose build
docker compose --profile setup run --rm model-setup
docker compose up -d analysis caddy
docker compose ps
```

Check the actual HTTPS `/health` response from outside the host. It must report
`ready:true`, `serviceMode:"shared"`, `authentication:"installation"`, the
advertised limits and the fixed 24-hour/90-day privacy profile. Exercise a genuine
upload and cancellation before supplying that HTTPS base URL to the app release
configuration. Do not put an installation token in a release build.

The template uses Caddy 2.11.7. Source checks verified its release and parser
configuration; [service recovery evidence](../docs/validation/shared-service-recovery.json)
records the official archive checksum, Caddy validation and Compose schema check. A template or
passing localhost test is not evidence that DNS, public TLS, firewall rules,
container networking or physical Android playback has been validated.

Use a single Uvicorn worker. A filesystem lock covers database construction and
migration as well as the running service. Old private databases are migrated in
one transaction into the `private` namespace, preserving their results and keys;
shared installations cannot read them. A future schema version is refused before
migration. Back up the stopped database before an operator upgrade, protect it
as private data, and restore compatible code/database together if rolling back.
Do not restore audio archives as part of this service: its normal policy deletes
the uploaded source after processing.

## Native operator development and private compatibility

Python setup below is for developers/operators, not an ordinary app user. Install
Python 3.12, FFmpeg and FFprobe. On Linux, from `backend`:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install torch==2.7.1 --index-url https://download.pytorch.org/whl/cpu
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m freetune_analysis.setup_models --model small
FREETUNE_SERVICE_MODE=shared .venv/bin/python -m freetune_analysis --port 8765
```

On Windows, use `py -3.12 -m venv .venv`, `.venv\Scripts\python`, and PowerShell
`$env:FREETUNE_SERVICE_MODE='shared'`. A public deployment requires HTTPS ingress;
the localhost command is for development. Keep uploaded content away from backups
and shared temporary directories. Set a service-owned `TMPDIR` on Linux for
multipart spools when operating outside the supplied container.

The default **native** mode remains `private` for existing scripts and data. It
uses `FREETUNE_API_TOKEN` when set; binding private mode outside loopback without
that token is refused. `/v1/installations` is disabled in private mode. The old
private job routes and result schema continue to work. Private development does
not change the ordinary app's shared-service contract.

Core configuration is in [config.py](freetune_analysis/config.py) and the explicit
shared environment in [compose.yaml](deploy/compose.yaml). The shared profile
requires exactly `FREETUNE_RETENTION_HOURS=24` and
`FREETUNE_INSTALLATION_TTL_DAYS=90`; private installations may override them.
The larger ASR model is optional for experiments: explicitly download `turbo`,
set `FREETUNE_WHISPER_MODEL=turbo`, and point `FREETUNE_WHISPER_PATH` at that model.
Changing a model is not approval of its quality.

## Reproducing verification

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q tests
.venv/bin/python -m freetune_analysis.shared_smoke /absolute/path/original.mp3 \
  --language en --output data/evaluation/shared-smoke/report.json
```

The contract suite uses real SQLite, process cancellation, and actual localhost
TCP tests for admission, streaming deadlines, tenant isolation and lost-response
cancellation. Most API tests deliberately park inference. The separate smoke
runner uses installed models and a supplied original recording, creates two
installations, retrieves actual lyrics/chords, checks retries/ownership, removes
audio, and restarts the service to verify result/access continuity. It refuses to
overwrite existing evidence. Its full result is saved beside its report for the
app's own validator. Neither test establishes transcription accuracy by itself.

The 2026-11-13 recovery smoke passed 23 service checks on the original
240.562-second Cortéz recording with small/CPU/four threads. It returned 37 lyric
lines and 77 chord intervals and explicitly warned `lyrics_unreliable` and
`word_timing_unreliable`. Worker time was 68.293 seconds, sampled peak RSS was
1589.47 MiB, and the complete smoke including uploads and restart took 74.748
seconds. Another evaluation was running concurrently, so these values are not a
controlled speed comparison. The evidence file also distinguishes that model run
from subsequent service-only startup and failed-publication cleanup checks.

The existing benchmark/downloader modules retain the Jam-ALT/JamendoLyrics
workflow. Human references are used after inference only. Keep recording licenses
and attribution with any shared demo. Unverified automatic output must remain
labelled automatic; do not replace it with reference lyrics for a demonstration.

## Dependency and ingress sources

The restored HTTP pins are FastAPI 0.141.0 (MIT), Starlette 1.3.1 (BSD-3-Clause),
and python-multipart 0.0.33 (Apache-2.0). These are explicit tested pins, not a claim
that every transitive dependency has no vulnerability. The package metadata and
primary advisories were checked on 2026-11-13:

- [FastAPI 0.141.0 metadata](https://pypi.org/project/fastapi/0.141.0/)
- [Starlette 1.3.1 metadata](https://pypi.org/project/starlette/1.3.1/)
- [python-multipart 0.0.33 metadata](https://pypi.org/project/python-multipart/0.0.33/)
- [Starlette form-limit advisory, fixed in 1.3.1](https://github.com/Kludex/starlette/security/advisories/GHSA-82w8-qh3p-5jfq)
- [Starlette large multipart parsing advisory](https://github.com/Kludex/starlette/security/advisories/GHSA-2c2j-9gv5-cj73)
- [Caddy 2.11.7 release](https://github.com/caddyserver/caddy/releases/tag/v2.11.7)
- [Caddy request-body limits](https://caddyserver.com/docs/caddyfile/directives/request_body)
- [Caddy server timeouts and header limits](https://caddyserver.com/docs/caddyfile/options)

Whisper/LV-Chordia license details are in the model license document. FFmpeg's
license follows the actual distributed build; it is a server process and is not
linked into the Android application.

### Public endpoint release gate

Before setting `src/config/analysis-service.json`, run the **read-only**
preflight against the deployed HTTPS origin from outside its host:

```bash
python3 backend/deploy/release_preflight.py https://analysis.example.org
python3 -m unittest discover -s backend/tests -p test_release_preflight.py
```

Run the first command from the repository root, using **your real service
domain** instead of the example. It verifies the TLS certificate and hostname,
requires an HTTPS origin without credentials, rejects redirects, limits the
health response size, and checks `ready=true`, `serviceMode=shared` and
`authentication=installation`. It makes only a GET /health request: it
neither registers an installation nor uploads a recording.

A successful preflight is **necessary but insufficient** for release. Also run
the real-model shared smoke, confirm cleanup and upload/cancel over the public
HTTPS endpoint, monitor disk pressure and RAM, and perform physical Android
testing. Keep the URL **empty** when any check is missing. The preflight never
creates DNS, hosting, certificates or paid services.
