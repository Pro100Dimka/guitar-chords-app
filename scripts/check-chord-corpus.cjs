// @ts-nocheck
// Node-only audit, like verify-shazam.cjs; the app tsconfig supplies RN types.
// Live, sequential content-lookup audit. Never writes lyric or chord-chart text.
// Usage: node scripts/check-chord-corpus.cjs <manifest.json> <results.jsonl> [id,id,...]
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const { Parser, DomHandler, DomUtils } = require("htmlparser2");

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

const selectedIds = process.argv[4]?.split(",");
if (
  selectedIds &&
  (new Set(selectedIds).size !== selectedIds.length ||
    selectedIds.some((id) => !songs.some((song) => song.id === id)))
)
  throw new Error("Selected IDs must be unique entries in the frozen manifest");
const selectedSongs = selectedIds
  ? songs.filter((song) => selectedIds.includes(song.id))
  : songs;

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
const { hasSongChordsAsync, isChordLine, chordNotationPattern, normalizeChord } =
  require(path.join(root, "src/screens/song/chords.ts"));
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
  count: selectedSongs.length,
  corpusCount: songs.length,
  selectedIds: selectedIds ?? null,
  concurrency:
    "One song at a time in one process; application provider concurrency, crawl delay and cooldowns unchanged",
  successCriterion:
    "Provider-validated identity plus repeated title/artist field checks using production normalization and hasSongChordsAsync(content, signal, true)",
  lyricCorroboration:
    "Diagnostic-only unique normalized lyric-line overlap with identity-matching LRCLIB plainLyrics; does not change status",
  includesAudioRecognition: false,
  recordsLyrics: false
});

let requests = [];
let searchMetadataJobs = [];
let lyricReferenceState;
const boundedLabel = (value, limit) =>
  value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim().slice(0, limit);
function guitareTabSearchMetadata(text) {
  const handler = new DomHandler();
  new Parser(handler).end(text);
  const rows = DomUtils.findAll(
    (element) =>
      (element.attribs.class ?? "").split(/\s+/).includes("gt-list__row"),
    handler.root.children
  );
  const metadata = {
    status: "parsed",
    bodyChars: text.length,
    rowCount: rows.length,
    rows: rows.slice(0, 15).map((row) => ({
      links: DomUtils.getElementsByTagName("a", row.children)
        .slice(0, 6)
        .map((link) => ({
          label: boundedLabel(DomUtils.textContent(link), 160),
          href: boundedLabel(link.attribs.href ?? "", 500)
        }))
    }))
  };
  if (!rows.length) {
    const title = DomUtils.getElementsByTagName("title", handler.root.children)[0];
    metadata.pageTitle = title ? boundedLabel(DomUtils.textContent(title), 160) : "";
  }
  return metadata;
}
const rawFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const trace = { url: String(url), status: null, ms: null };
  requests.push(trace);
  const metadataJobs = searchMetadataJobs;
  const references = lyricReferenceState;
  const began = Date.now();
  try {
    const response = await rawFetch(url, options);
    trace.status = response.status;
    if (
      response.status === 200 &&
      /^https:\/\/www\.guitaretab\.com\/fetch\/\?/.test(trace.url)
    ) {
      // Observe the production read; cloning would leave a second body stream.
      const readText = response.text.bind(response);
      trace.guitareTabContentType = boundedLabel(
        response.headers.get("content-type") ?? "",
        160
      );
      trace.guitareTabSearch = { status: "not_read" };
      response.text = async () => {
        const text = await readText();
        try {
          if (text.length > 2000000 || Buffer.byteLength(text, "utf8") > 2000000) {
            trace.guitareTabSearch = { status: "too_large" };
          } else {
            trace.guitareTabSearch = { status: "pending" };
            metadataJobs.push(() => {
              try {
                trace.guitareTabSearch = guitareTabSearchMetadata(text);
              } catch {
                trace.guitareTabSearch = { status: "parse_failed" };
              }
            });
          }
        } catch {
          trace.guitareTabSearch = { status: "capture_failed" };
        }
        return text;
      };
    }
    if (
      response.status === 200 &&
      /^https:\/\/lrclib\.net\/api\/search\?/.test(trace.url) &&
      references
    ) {
      const readJson = response.json.bind(response);
      response.json = async () => {
        const data = await readJson();
        try {
          if (!references.closed && Array.isArray(data)) {
            for (const item of data) {
              if (references.lyrics.length === 20) break;
              if (
                item &&
                !item.instrumental &&
                typeof item.id === "number" &&
                typeof item.trackName === "string" &&
                typeof item.artistName === "string" &&
                typeof item.plainLyrics === "string" &&
                item.plainLyrics.length <= 200000 &&
                item.plainLyrics.trim() &&
                api.matchingIdentity(references.title, item.trackName) &&
                sameArtist(references.artist, item.artistName, "LRCLIB")
              )
                references.lyrics.push(item.plainLyrics);
            }
          }
        } catch {
          references.failed = true;
        }
        return data;
      };
    }
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
  const names = api.publishedArtistNames(actual);
  if (source === "Akkords.pro")
    names.push(primaryArtist(actual).replace(/\s+\([^()]+\)\s*$/, ""));
  return credits.some((credit) =>
    names.some((name) =>
      api.matchingIdentity(artistKey(credit), artistKey(name))
    )
  );
}

const lyricLineKey = (line) =>
  line.normalize("NFKC").toLowerCase().replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function lyricLines(content, title) {
  const lines = new Set();
  const titleKey = lyricLineKey(title);
  for (const line of content.split(/\r?\n/)) {
    if (isChordLine(line)) continue;
    const plain = line.replace(/\[([^\[\]]+)\]/g, (marked, chord) =>
      chordNotationPattern.test(normalizeChord(chord)) ? "" : marked
    );
    if (isChordLine(plain)) continue;
    const key = lyricLineKey(plain);
    if (
      key !== titleKey &&
      key.split(" ").filter((word) => /\p{L}/u.test(word)).length >= 3
    )
      lines.add(key);
  }
  return lines;
}
function corroborateLyrics(content, references) {
  try {
    const candidateLines = lyricLines(content, references.title);
    references.lines ??= new Set(
      references.lyrics.flatMap((lyrics) => [...lyricLines(lyrics, references.title)])
    );
    const matchedLineCount = [...candidateLines].filter((line) => references.lines.has(line)).length;
    return {
      matchedLineCount,
      referenceLineCount: references.lines.size,
      candidateLineCount: candidateLines.size,
      status: references.failed ? "diagnostic_error"
        : matchedLineCount ? "overlap"
          : !references.lines.size ? "unknown_no_reference"
            : !candidateLines.size ? "unknown_no_candidate_lines"
              : "unknown_no_overlap"
    };
  } catch {
    return { matchedLineCount: 0, referenceLineCount: 0, candidateLineCount: 0, status: "diagnostic_error" };
  }
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
    total: selectedSongs.length,
    byStatus,
    byGroup
  };
}

(async () => {
  for (const song of selectedSongs) {
    const began = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    requests = [];
    searchMetadataJobs = [];
    const references = (lyricReferenceState = {
      title: song.title, artist: song.artist, lyrics: [], closed: false, failed: false
    });
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
        const optionMetadata = {
          title: option.title,
          artist: option.artist,
          source: option.source,
          url: option.url,
          contentLength: option.content.length,
          providerHasChords: !!option.hasChords,
          lyricsAndChords,
          identityMatches
        };
        if (option.sourceArtist) optionMetadata.sourceArtist = option.sourceArtist;
        if (option.identityReference) optionMetadata.identityReference = option.identityReference;
        result.options.push(optionMetadata);
        if (option.source !== "LRCLIB")
          searchMetadataJobs.push(() => {
            optionMetadata.lyricCorroboration = corroborateLyrics(option.content, references);
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
    references.closed = true;
    // Parse after lookup timing, before serialization; retain no response bodies.
    for (const collect of searchMetadataJobs.splice(0)) collect();
    references.lyrics.length = 0;
    references.lines?.clear();
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
        total: selectedSongs.length,
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
