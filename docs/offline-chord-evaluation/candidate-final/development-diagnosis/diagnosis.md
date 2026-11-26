# Rejected candidate 2: causal diagnosis and narrow correction

Candidate `third-consistency-v2` was rejected on the known development recording
before opening the fresh holdout. Its immutable binary and sources remain in
`production-candidate-2`. No holdout evaluation informed this correction.

## Observations and ablation

The first D span was split into D5 then Dsus2. The first A span was split into A5
then Amadd9. Instrumentation on a 20-second prefix reproduces the full frozen
production intro exactly through 15.968 seconds. The note dump itself uses the
complete recording and unchanged production NoteAnalyzer.

Removing only relaxed note acceptance restores both full Dsus2 and Asus2 spans
while retaining the fresh-third consistency guard. Removing only that guard
leaves both false splits, but changes Amadd9 back to Asus2 after the A5 prefix.
The regressions therefore have two separate, observed causes.

1. **Weak prior notes seed a new quality state.** The widened initial gate admits
   a decaying fourth from the preceding harmony: G1 over D and D4 over A. Each
   fails the original strong gate, passes the relaxed one, and establishes an
   initial fourth state. The genuinely delayed second is then misread as a
   fourth-to-second change instead of completion of one arpeggio.
2. **Unrelated peaks become false joint evidence.** The A span's C2 note peak
   (.435563 at13.898594s) and onset peak (.355171 at13.260045s) are .63855s apart.
   Their product crosses .15. Pairing onset with nearby note evidence within the
   already-used ±.06s radius reaches only .126787. The genuine weak E2 in the
   earlier Funk development clip reaches .153901 with this same local pairing;
   the genuine short Rock C#4 third reaches .410408.

## Correction

Root, initial-quality and boundary decisions retain the original strong gate.
Moderate evidence may contribute only to the final formula, and it must pair an
onset with nearby frame-note evidence. The fresh-third consistency guard uses
an onset peak inside the current segment plus local note support, so independent
maxima elsewhere in a span cannot ban power/suspended labels.

The thresholds and radius are existing values; there are no song titles, keys,
expected progressions or song-specific timestamps in production code. The fix
changes no root-path, segmentation score, model or native contract.

## Generic regression controls

Two new parameterized controls cover all12 roots: 48 synchronous/asynchronous
weak-third cases, with and without a sustained second, and12 prior-fourth tail
followed by a delayed-second cases. The rejected candidate fails both controls
in C (wrong C instead of C5, and false C5/Csus2 split). Existing29 test functions,
including36 short-third and harmonic-blip cases, remain unchanged. Final matrix
and build results are recorded separately in the new candidate freeze.

See `diagnosis.json`, raw trace logs, ablation output JSON, the rejected-candidate
probe failure logs and `candidate2-to-aligned.patch` for exact values and hashes.
These are development diagnostics, not accuracy on unseen recordings.
