#!/usr/bin/env node
// @ts-nocheck
// Node-only recognition diagnostic; the app tsconfig supplies React Native types.
/* Execute the production note/style/tab post-processing in a ready-PR check. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");
const { performance } = require("node:perf_hooks");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const sources = [
  "src/components/audio-transcription.ts",
  "src/components/audio-rhythm.ts",
  "src/components/audio-tablature.ts",
  "src/components/tablature.ts"
];
const allowed = new Set(sources.map((file) => path.join(root, file)));
const sha256 = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

function loadProduction() {
  const previous = Module._extensions[".ts"];
  // A bounded TS loader avoids loading the React Native app or copying the
  // algorithms into an evaluator. Type checking remains in the app CI job.
  Module._extensions[".ts"] = (module, filename) => {
    if (!allowed.has(filename))
      throw new Error("Unexpected module: " + filename);
    const source = fs.readFileSync(filename, "utf8");
    const compiled = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS
      }
    });
    module._compile(compiled.outputText, filename);
  };
  try {
    return {
      ...require("../src/components/audio-transcription.ts"),
      ...require("../src/components/audio-rhythm.ts"),
      ...require("../src/components/audio-tablature.ts"),
      ...require("../src/components/tablature.ts")
    };
  } finally {
    if (previous) Module._extensions[".ts"] = previous;
    else delete Module._extensions[".ts"];
  }
}

function inspect(input) {
  const native = JSON.parse(input.toString("utf8"));
  const production = loadProduction();
  const notes = production.decodeAudioNoteTranscription(
    native,
    native.duration
  );
  if (!notes) throw new Error("Native output has no note transcription");
  if (notes.truncated) throw new Error("Benchmark transcription is incomplete");
  const range = { start: 0, end: native.duration };
  // Match the application's initialization. Reference tempo/key/style are never
  // loaded by this runner and cannot influence the detected notes or tablature.
  const tempo = native.tempo === null ? 80 : Math.round(native.tempo);
  const rhythmStarted = performance.now();
  const rhythm = production.analyzeAudioRhythm(notes, range);
  const projectionStarted = performance.now();
  const projection = production.projectAudioTablature(notes, range, tempo);
  const finished = performance.now();
  return {
    schemaVersion: 1,
    nativePredictionSha256: sha256(input),
    duration: native.duration,
    ticksPerBeat: production.TAB_TICKS_PER_BEAT,
    tuningMidi: [...production.TAB_TUNING],
    rhythm,
    projection,
    timings: {
      rhythmMs: projectionStarted - rhythmStarted,
      projectionMs: finished - projectionStarted,
      scope: "Single Linux/Node host pass; not phone latency"
    },
    sources: Object.fromEntries(
      sources.map((file) => [
        file,
        sha256(fs.readFileSync(path.join(root, file)))
      ])
    ),
    runtime: { node: process.version, typescript: ts.version }
  };
}

if (require.main === module) {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    console.error(
      "Usage: node inspect-audio-performance.cjs native.json performance.json"
    );
    process.exitCode = 1;
  } else {
    const result = inspect(fs.readFileSync(input));
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
    console.log(
      JSON.stringify({
        playingStyle: result.rhythm.style,
        projection: result.projection.status,
        counts: result.projection.counts,
        timings: result.timings
      })
    );
  }
}

module.exports = { inspect };
