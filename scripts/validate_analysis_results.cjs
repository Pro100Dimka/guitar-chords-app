const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const root = process.cwd();
const ts = require(path.join(root, "node_modules/typescript"));
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const validatorPath = path.join(root, "src/components/song-analysis/types.ts");
const validatorSource = fs.readFileSync(validatorPath, "utf8");
const compiled = ts.transpileModule(validatorSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const moduleExports = {};
vm.runInNewContext(
  compiled,
  { exports: moduleExports },
  { filename: validatorPath, timeout: 5000 }
);
const validateSongAnalysis = moduleExports.validateSongAnalysis;
if (typeof validateSongAnalysis !== "function")
  throw new Error("Actual client validator export missing");
const targets = [];
const missing = [];
const manifestPath = option("--manifest");
const resultsPath = option("--results");
if (!!manifestPath !== !!resultsPath)
  throw new Error("--manifest and --results must be supplied together");
if (manifestPath && resultsPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.recordings) || !manifest.recordings.length)
    throw new Error("Manifest must contain recordings");
  for (const entry of manifest.recordings) {
    if (typeof entry.id !== "string" || path.basename(entry.id) !== entry.id)
      throw new Error("Invalid recording ID");
    const resultFile = path.resolve(resultsPath, entry.id + ".analysis.json");
    if (!fs.existsSync(resultFile)) {
      missing.push(entry.id);
      continue;
    }
    targets.push({
      dataset: manifest.corpus?.name || "manifest",
      id: entry.id,
      resultFile,
      audioFile: path.resolve(path.dirname(manifestPath), entry.audio),
      expectedSha: entry.audioSha256 || entry.sha256
    });
  }
}
const guitarResults = option("--guitarset-results");
const guitarFixtures = option("--guitarset-fixtures");
if (!!guitarResults !== !!guitarFixtures)
  throw new Error("--guitarset-results and --guitarset-fixtures must be supplied together");
if (guitarResults && guitarFixtures) {
  for (const id of fs.readdirSync(guitarResults).sort()) {
    const resultFile = path.join(guitarResults, id, "state.json");
    if (!fs.existsSync(resultFile)) continue;
    const reference = JSON.parse(
      fs.readFileSync(path.join(guitarFixtures, id + ".reference.json"), "utf8")
    );
    targets.push({
      dataset: "GuitarSet",
      id,
      resultFile,
      audioFile: path.join(guitarFixtures, id + "_mic.wav"),
      expectedSha: reference.sha256
    });
  }
}
const checks = [];
for (const item of targets) {
  try {
    const job = JSON.parse(fs.readFileSync(item.resultFile, "utf8"));
    if (!["completed", "partial"].includes(job.status))
      throw new Error("Not a final successful result: " + job.status);
    const result = validateSongAnalysis(job.result);
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration:stream=codec_type,duration",
          "-of",
          "json",
          item.audioFile
        ],
        { encoding: "utf8", timeout: 30000 }
      )
    );
    const originalDuration = Number(
      probe.format?.duration ??
        probe.streams?.find((s) => s.codec_type === "audio")?.duration
    );
    if (!Number.isFinite(originalDuration) || originalDuration <= 0)
      throw new Error("No valid original-file duration");
    const delta = Math.abs(result.duration - originalDuration);
    if (delta > 0.5)
      throw new Error("Original duration mismatch: " + delta + "s");
    const actualSha = sha(fs.readFileSync(item.audioFile));
    if (item.expectedSha && item.expectedSha !== actualSha)
      throw new Error("Manifest source checksum mismatch");
    const expectedSha = job.audio_sha256 || item.expectedSha;
    if (!expectedSha || expectedSha !== actualSha)
      throw new Error("Original file checksum mismatch/missing");
    checks.push({
      dataset: item.dataset,
      id: item.id,
      status: job.status,
      passed: true,
      originalDurationSeconds: originalDuration,
      resultDurationSeconds: result.duration,
      durationDeltaSeconds: delta,
      sourceSha256: actualSha,
      lyricLines: result.lyrics.length,
      wordIntervals: result.lyrics.reduce(
        (n, line) => n + line.words.length,
        0
      ),
      chordIntervals: result.chords.length
    });
  } catch (error) {
    checks.push({
      dataset: item.dataset,
      id: item.id,
      passed: false,
      error: error.message
    });
  }
}
const passed = checks.filter((x) => x.passed);
const report = {
  validator: "src/components/song-analysis/types.ts:validateSongAnalysis",
  validatorSha256: sha(validatorSource),
  loadedVia:
    "typescript.transpileModule + VM; actual project function, no copied validator",
  checkedAt: new Date().toISOString(),
  originalDurationMethod:
    "ffprobe original recording container/audio duration, fixed client tolerance0.5s; not an Android MediaExtractor measurement",
  checks: checks,
  missingResults: missing,
  summary: {
    checked: checks.length,
    passed: passed.length,
    failed: checks.length - passed.length,
    totalLyricLines: passed.reduce((n, x) => n + x.lyricLines, 0),
    totalWordIntervals: passed.reduce((n, x) => n + x.wordIntervals, 0),
    totalChordIntervals: passed.reduce((n, x) => n + x.chordIntervals, 0),
    maxDurationDeltaSeconds: passed.length
      ? Math.max(...passed.map((x) => x.durationDeltaSeconds))
      : null
  }
};
const output = option("--output");
if (output) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
}
console.log(
  JSON.stringify(
    {
      summary: report.summary,
      byDataset: Object.fromEntries(
        [...new Set(checks.map((x) => x.dataset))].map((d) => [
          d,
          {
            checked: checks.filter((x) => x.dataset === d).length,
            passed: checks.filter((x) => x.dataset === d && x.passed).length
          }
        ])
      ),
      missingResults: missing,
      failures: checks.filter((x) => !x.passed),
      output
    },
    null,
    2
  )
);
// An absent corpus/result cannot be reported as a successful zero-test validation.
if (report.summary.failed || missing.length || !checks.length) process.exitCode = 1;
