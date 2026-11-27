# BasicPitch model conversion

This isolated build tool converts the pinned Spotify BasicPitch ONNX model into
the NNEF asset loaded by the application. It is not an application dependency.
The application needs `tract-nnef`; only this converter needs `tract-onnx`.

## Reproduce the asset

Requirements: Python 3, a Rust toolchain compatible with tract 0.23.9, and Cargo.
The checked conversion used Rust 1.100.0 on x86_64 Linux. Cargo.lock pins the Rust
dependencies. A different toolchain/platform must produce the same archive hash
before its output is accepted.

From the repository root, download the official pinned source and convert it:

```sh
python3 scripts/chord-model-converter/convert.py --output /tmp/basic-pitch.nnef.tar
```

To use a previously downloaded official ONNX file and cached Rust dependencies:

```sh
python3 scripts/chord-model-converter/convert.py \
  --source /path/to/nmp.onnx \
  --output /tmp/basic-pitch.nnef.tar \
  --offline
```

Optional `--cargo /path/to/cargo` and `--target-dir /path/to/build-cache` select a
toolchain executable and separate build cache. The wrapper verifies both source
and output size/SHA-256. It leaves the destination untouched when validation
fails. It never trains, quantizes, or changes model weights.

## Pinned model and license

- Upstream repository: <https://github.com/spotify/basic-pitch>
- Commit: `fa5997af0a8210982619003269994a1be25eddf3`
- Source: <https://raw.githubusercontent.com/spotify/basic-pitch/fa5997af0a8210982619003269994a1be25eddf3/basic_pitch/saved_models/icassp_2022/nmp.onnx>
- License: Apache-2.0. The derived model retains the Spotify model's license and
  attribution; retain the upstream LICENSE with the application's model assets.
- Original ONNX: **230,444 bytes**,
  SHA-256 `2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec`.
- Canonical NNEF tar: **196,096 bytes**,
  SHA-256 `274e46d8b4eec2d6a9da1d52d60744feb7f7dfdf6207dc12db10f5ddd9f3416f`.

## Conversion and public tensor contract

The converter fixes the single float32 input to **[1, 43844, 1]**, representing
one 22,050 Hz audio window. It explicitly preserves this output order:

| Index | Meaning | ONNX outlet label | NNEF public label | Shape |
| --- | --- | --- | --- | --- |
| 0 | Note activation | `StatefulPartitionedCall:1` | `StatefulPartitionedCall_1` | `[1, 172, 88]` |
| 1 | Onset activation | `StatefulPartitionedCall:2` | `StatefulPartitionedCall_2` | `[1, 172, 88]` |
| 2 | Pitch contour | `StatefulPartitionedCall:0` | `StatefulPartitionedCall_0` | `[1, 172, 264]` |

The NNEF input identifier is `serving_default_input_2_0`. The application can
select note/onset by their public labels before optimization and omit contour
from inference when it is unnecessary.

Conversion uses `into_typed()?.into_decluttered()?`, then renames only internal
nodes in evaluation order and writes a deterministic NNEF tar. The public input
and output labels stay intact. The name normalization is necessary: tract's
deterministic tar option fixes timestamps, but decluttering can generate random
temporary name suffixes. Independent converter processes reproduced the pinned
canonical archive hash.

Do not export after `into_optimized()`: tract 0.23.9 produces low-level
`IntoShape` nodes without a NNEF serializer. Load the exported typed graph using
the standard `tract_nnef::nnef()` registry, then call `into_optimized()` and
`into_runnable()` in the runtime. No custom or ONNX operator registry is needed.

The API implementation is the official tract 0.23.9 source:

- <https://docs.rs/tract-nnef/0.23.9/src/tract_nnef/framework.rs.html>
- <https://docs.rs/tract-nnef/0.23.9/src/tract_nnef/ser.rs.html>
- <https://docs.rs/tract-core/0.23.9/src/tract_core/model/typed.rs.html>

## Verification scope

`parity-evidence.json` records the one-window probe: canonical NNEF produced
bitwise-identical note, onset and contour tensors to the original ONNX-loaded
tract model. It includes the input/output hashes for replay. This establishes
parity for that input; it is not a full-song or phone validation claim.

The separate stripped x86_64 Linux probes were 22,667,696 bytes for ONNX loading
and 16,841,272 bytes for NNEF-only loading; gzip level 9 sizes were 7,070,472 and
5,283,609 bytes. Those are **host CLI measurements**, not APK/IPA size increments.
The evidence retains all timing runs. ONNX warm medians were 83.71 and 86.40 ms;
the final canonical NNEF archive measured 98.24 and 99.02 ms, about 15% slower in
the repeated pair. The initial archive before name canonicalization measured
84.94 ms. This is a size/output-parity result, not proof of identical speed.
Target-device measurement is still needed; these short host probes do not
establish a mobile speed promise. Canonicalizing names preserves bitwise outputs
but is not itself an inference optimization.
