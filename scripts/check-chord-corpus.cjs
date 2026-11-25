// @ts-nocheck
// Node-only audit, like verify-shazam.cjs; the app tsconfig supplies RN types.
// Live, sequential content-lookup audit. Never writes lyric or chord-chart text.
// Usage: node scripts/check-chord-corpus.cjs <manifest.json> <results.jsonl>
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const manifestPath = path.resolve(root, process.argv[2] || "");
const outputPath = process.argv[3] && path.resolve(root, process.argv[3]);
if (!process.argv[2] || !outputPath)
  throw new Error("Pass a frozen manifest JSON and a new output JSONL path");
const manifestBytes = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes);
const songs = manifest.songs;
const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const actualCounts = {};
for (const song of songs)
  actualCounts[song.group] = (actualCounts[song.group] || 0) + 1;
if (
  songs.length !== 100 ||
  new Set(
    songs.map(
      (song) => `${song.artist.toLowerCase()}:${song.title.toLowerCase()}`
    )
  ).size !== 100 ||
  Object.entries(manifest.expectedCounts).some(
    ([group, count]) => actualCounts[group] !== count
  )
)
  throw new Error("Expected the complete frozen set of 100 unique identities");

const sourceSha256 = {};
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  sourceSha256[path.relative(root, filename)] = sha256(source);
  module._compile(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    filename
  );
};
const api = require(path.join(root, "src/components/song-autofill/lyrics.ts"));
const { hasSongChordsAsync } = require(
  path.join(root, "src/screens/song/chords.ts")
);
const timeoutMs = 60000;
const startedAt = new Date().toISOString();
const descriptor = fs.openSync(outputPath, "wx");
const write = (entry) => fs.writeSync(descriptor, JSON.stringify(entry) + "\n");
write({
  kind: "run",
  startedAt,
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8"
  }).trim(),
  node: process.version,
  platform: process.platform,
  manifest: path.relative(root, manifestPath),
  manifestSha256: sha256(manifestBytes),
  sourceSha256,
  timeoutMs,
  count: songs.length,
  concurrency:
    "One song at a time in one process; application provider concurrency, crawl delay and cooldowns unchanged",
  successCriterion:
    "Provider-validated identity plus independent title/artist comparison and hasSongChordsAsync(content, signal, true)",
  includesAudioRecognition: false,
  recordsLyrics: false
});

let requests = [];
const rawFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const trace = { url: String(url), status: null, ms: null };
  requests.push(trace);
  const began = Date.now();
  try {
    const response = await rawFetch(url, options);
    trace.status = response.status;
    return response;
  } catch (error) {
    trace.error = error?.name || "Error";
    throw error;
  } finally {
    trace.ms = Date.now() - began;
  }
};

const primaryArtist = (value) =>
  value.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, "").trim();
const artistKey = (value) =>
  value.replace(/\s*&\s*/g, " and ").replace(/[^\p{L}\p{N}]/gu, "");
function sameArtist(expected, actual, source) {
  const credits = [
    primaryArtist(expected),
    ...expected.split(/\s+(?:&|feat\.?|ft\.?|featuring|with)\s+/i)
  ];
  const names = [primaryArtist(actual)];
  if (source === "Akkords.pro")
    names.push(primaryArtist(actual).replace(/\s+\([^()]+\)\s*$/, ""));
  return credits.some((credit) =>
    names.some((name) =>
      api.matchingIdentity(artistKey(credit), artistKey(name))
    )
  );
}

const completed = [];
const summaryPath = outputPath.replace(/\.jsonl$/, "") + ".summary.json";
function summary(finished) {
  const byStatus = {},
    byGroup = {};
  for (const result of completed) {
    byStatus[result.status] = (byStatus[result.status] || 0) + 1;
    const group = (byGroup[result.group] ||= {
      checked: 0,
      lyricsAndChords: 0
    });
    group.checked++;
    if (result.status === "lyrics_and_chords") group.lyricsAndChords++;
  }
  return {
    startedAt,
    updatedAt: new Date().toISOString(),
    finished,
    manifestSha256: sha256(manifestBytes),
    sourceSha256,
    completed: completed.length,
    total: songs.length,
    byStatus,
    byGroup
  };
}

(async () => {
  for (const song of songs) {
    const began = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    requests = [];
    const result = {
      kind: "song",
      id: song.id,
      group: song.group,
      language: song.language,
      title: song.title,
      artist: song.artist,
      status: "error",
      options: []
    };
    try {
      const options = await api.lookupSongContent(
        song.title,
        song.artist,
        controller.signal
      );
      for (const option of options) {
        const identityMatches =
          api.matchingIdentity(song.title, option.title) &&
          sameArtist(song.artist, option.artist, option.source);
        const lyricsAndChords =
          !!option.hasChords &&
          (await hasSongChordsAsync(option.content, controller.signal, true));
        result.options.push({
          title: option.title,
          artist: option.artist,
          source: option.source,
          url: option.url,
          contentLength: option.content.length,
          providerHasChords: !!option.hasChords,
          lyricsAndChords,
          identityMatches
        });
      }
      result.status = result.options.some(
        (option) => option.identityMatches && option.lyricsAndChords
      )
        ? "lyrics_and_chords"
        : result.options.some((option) => option.lyricsAndChords)
          ? "identity_mismatch"
          : result.options.length
            ? "lyrics_only"
            : "no_matching_arrangement";
    } catch (error) {
      const code = [
        "MissingIdentity",
        "Cancelled",
        "ChordSourcesUnavailable",
        "LyricsServiceUnavailable",
        "RateLimited",
        "InvalidLyricsResponse"
      ].includes(error?.message)
        ? error.message
        : error?.name || "Error";
      result.error = code;
      result.status = controller.signal.aborted
        ? "timeout"
        : code === "ChordSourcesUnavailable"
          ? "source_unavailable"
          : "error";
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
    await new Promise(setImmediate);
    result.ms = Date.now() - began;
    result.requests = requests;
    completed.push(result);
    write(result);
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(summary(false), null, 2) + "\n"
    );
    console.log(
      JSON.stringify({
        completed: completed.length,
        total: songs.length,
        id: song.id,
        title: song.title,
        artist: song.artist,
        status: result.status,
        ms: result.ms,
        sources: result.options
          .filter((option) => option.identityMatches && option.lyricsAndChords)
          .map((option) => option.source)
      })
    );
  }
  const final = summary(true);
  write({ kind: "summary", ...final });
  fs.writeFileSync(summaryPath, JSON.stringify(final, null, 2) + "\n");
  fs.closeSync(descriptor);
  console.log(JSON.stringify(final));
})().catch((error) => {
  fs.closeSync(descriptor);
  console.error(error?.name || "Error");
  process.exitCode = 1;
});
