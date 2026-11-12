// Run with Node 22.13+ to exercise the application against SQLite in memory.
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const babel = require("@babel/core");
const WebSQLDatabase = require("websql/lib/websql/WebSQLDatabase");
const root = __dirname;
const sqlite = new DatabaseSync(":memory:");
let failure;
const adapter = {
  exec(queries, readOnly, callback) {
    if (queries.some(({ sql }) => sql === failure)) {
      callback(new Error(`Injected failure: ${failure}`));
      return;
    }
    const results = queries.map(({ sql, args }) => {
      try {
        const statement = sqlite.prepare(sql);
        if (statement.columns().length)
          return { rows: statement.all(...args), rowsAffected: 0 };
        const result = statement.run(...args);
        return {
          rows: [],
          rowsAffected: Number(result.changes),
          insertId: Number(result.lastInsertRowid)
        };
      } catch (error) {
        return { error };
      }
    });
    callback(null, results);
  }
};
const db = new WebSQLDatabase("1", adapter);
const modules = new Map();
let backupText = "";
const preferences = {
  instrument: "guitar",
  tuning: "standard",
  customTuning: [40, 45, 50, 55, 59, 64],
  tunerSound: true,
  chromaticOctave: null,
  autoDetect: true,
  stringIndex: 0,
  tab: "library",
  songs: {}
};
const stubs = {
  "@react-native-documents/picker": {
    saveDocuments: async () => [{ error: null }]
  },
  "@bam.tech/react-native-image-resizer": {},
  "react-native-file-access": {
    Dirs: { CacheDir: "/cache" },
    FileSystem: {
      writeFile: async (_path, text) => {
        backupText = text;
      },
      stat: async () => ({ size: Buffer.byteLength(backupText) }),
      unlink: async () => undefined
    }
  },
  "./preferences": {
    normalizeSongPreferences: (value) => value ?? {},
    suspendPreferenceSaving: () => () => undefined,
    usePreferences: {
      getState: () => preferences,
      setState: (update) =>
        Object.assign(
          preferences,
          typeof update === "function" ? update(preferences) : update
        )
    }
  }
};
function load(relative) {
  const filename = path.resolve(root, relative);
  if (filename === path.resolve(root, "src/components/database/index.ts"))
    return { db };
  if (modules.has(filename)) return modules.get(filename);
  const code = babel.transformFileSync(filename, {
    configFile: false,
    babelrc: false,
    presets: [require.resolve("@babel/preset-typescript")],
    plugins: [require.resolve("@babel/plugin-transform-modules-commonjs")]
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    console,
    require: (name) => {
      if (stubs[name]) return stubs[name];
      if (!name.startsWith(".")) return require(name);
      const relativePath = path.resolve(path.dirname(filename), name);
      return load(
        fs.existsSync(`${relativePath}.ts`)
          ? `${relativePath}.ts`
          : path.join(relativePath, "index.ts")
      );
    }
  });
  modules.set(filename, module.exports);
  return module.exports;
}
async function main() {
  const migrate = load("src/components/database/initTables.ts").default;
  const create = load("src/components/database/crud/create-item.ts").default;
  const read = load("src/components/database/crud/get-all-items.ts").default;
  const update = load("src/components/database/crud/update-item.ts").default;
  const remove = load("src/components/database/crud/delete-item.ts").default;
  failure = "END;";
  await assert.rejects(migrate(db), /Injected failure/);
  assert.equal(sqlite.prepare("PRAGMA user_version").get().user_version, 0);
  assert.equal(
    sqlite
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'songs'")
      .get().n,
    0
  );
  failure = undefined;
  await migrate(db);
  const { insertId } = await create({
    tableName: "bands",
    data: { name: "Guns N' Roses", search_text_lower: "guns n' roses" }
  });
  const rows = await read({
    tableName: "bands",
    filters: "name LIKE ?",
    parameters: ["%N' Roses%"]
  });
  assert.equal(rows[0].id, insertId);
  assert.equal(rows[0].name, "Guns N' Roses");
  await update({
    tableName: "bands",
    data: { name: "Updated" },
    filters: `id = ${insertId}`
  });
  assert.equal((await read({ tableName: "bands" }))[0].name, "Updated");
  sqlite.exec("PRAGMA user_version = 0");
  await migrate(db);
  assert.equal((await read({ tableName: "bands" })).length, 1);
  await migrate(db);
  assert.equal(sqlite.prepare("PRAGMA user_version").get().user_version, 2);
  for (const stage of ["BEGIN;", "END;"]) {
    failure = stage;
    await assert.rejects(
      create({ tableName: "bands", data: { name: "Must not persist" } }),
      /Injected failure/
    );
    failure = undefined;
    assert.equal((await read({ tableName: "bands" })).length, 1);
  }
  await remove({ tableName: "bands", filters: `id = ${insertId}` });
  assert.equal((await read({ tableName: "bands" })).length, 0);
  await audioScenarios(migrate, create, read, remove);
  sqlite.exec("PRAGMA user_version = 99");
  await assert.rejects(migrate(db), /newer application version/);
  assert.equal(sqlite.prepare("PRAGMA user_version").get().user_version, 99);
  console.log(
    "SQLite integration passed: CRUD, commit rollback, v1/v2 migration, duplicate audio imports, cancellation, stale responses, interruption/retry, manual edit preservation, optimistic revisions, backup/restore/relink, deletion cleanup."
  );
}

async function audioScenarios(migrate, create, read, remove) {
  const audio = load("src/components/database/audio-analysis.ts");
  const library = load("src/components/library-files.ts");
  const legacy = await create({
    tableName: "songs",
    data: {
      title: "Legacy",
      content: "Am\nOriginal text",
      search_text_lower: "legacy"
    }
  });
  await create({
    tableName: "settings",
    data: { key: "retained", value: "original" }
  });
  sqlite.exec(
    "DROP TRIGGER delete_song_audio; DROP TABLE audio_analysis_jobs; DROP TABLE song_audio; PRAGMA user_version = 1"
  );
  await migrate(db);
  assert.equal(
    (
      await read({
        tableName: "songs",
        filters: "id = ?",
        parameters: [legacy.insertId]
      })
    )[0].content,
    "Am\nOriginal text"
  );
  assert.equal(
    (
      await read({
        tableName: "settings",
        filters: "key = ?",
        parameters: ["retained"]
      })
    )[0].value,
    "original"
  );
  const metadata = {
    fileName: `${"a".repeat(64)}.wav`,
    originalName: "Original recording.wav",
    mimeType: "audio/wav",
    sha256: "a".repeat(64),
    bytes: 100000,
    durationMs: 12000
  };
  const imported = await audio.createAudioSong(metadata, "Recording");
  assert.equal(imported.created, true);
  const duplicate = await audio.createAudioSong(
    metadata,
    "Should not replace title"
  );
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.songId, imported.songId);
  const songId = imported.songId;
  const analysis = {
    version: 1,
    duration: 12,
    language: "uk",
    lyrics: [
      {
        start: 3,
        end: 8,
        text: "Пісня",
        words: [{ start: 3.1, end: 7.9, text: "Пісня", confidence: 0.82 }]
      }
    ],
    chords: [
      { start: 0, end: 4.3, label: "Am" },
      { start: 4.3, end: 12, label: "C" }
    ],
    warnings: [],
    model: { lyrics: "test", alignment: "test", chords: "test" }
  };
  const first = await audio.beginAnalysis(songId, "http://127.0.0.1:8765");
  await assert.rejects(
    audio.beginAnalysis(songId, "http://127.0.0.1:8765"),
    /AnalysisAlreadyRunning/
  );
  await audio.cancelAnalysis(first.id);
  assert.equal(
    (await audio.completeAnalysis(first.id, analysis)).applied,
    false
  );
  assert.equal((await audio.getAudioSong(songId)).analysis, null);
  const retry = await audio.beginAnalysis(songId, "http://127.0.0.1:8765");
  assert.equal(retry.attempt, 2);
  assert.equal(
    await audio.updateAnalysisJob(first.id, {
      status: "running",
      progress: 0.9
    }),
    false
  );
  failure = "END;";
  await assert.rejects(
    audio.completeAnalysis(retry.id, analysis),
    /Injected failure/
  );
  failure = undefined;
  assert.equal((await audio.getAudioSong(songId)).analysis, null);
  assert.equal((await audio.getAnalysisJob(songId)).status, "queued");
  await audio.completeAnalysis(retry.id, analysis);
  const manual = structuredClone(analysis);
  manual.lyrics[0].text = "Ручне виправлення";
  manual.lyrics[0].words = [];
  manual.chords[0].label = "Dm";
  await audio.saveManualAnalysis(songId, manual, 1);
  const third = await audio.beginAnalysis(songId, "http://127.0.0.1:8765");
  assert.equal(await audio.recoverInterruptedJobs(), 1);
  assert.equal((await audio.getAnalysisJob(songId)).status, "interrupted");
  const fourth = await audio.beginAnalysis(songId, "http://127.0.0.1:8765");
  assert.equal(
    (await audio.completeAnalysis(third.id, analysis)).applied,
    false
  );
  const completed = await audio.completeAnalysis(fourth.id, analysis, true);
  assert.equal(completed.preservedManual, true);
  let saved = await audio.getAudioSong(songId);
  assert.equal(saved.analysis.lyrics[0].text, "Ручне виправлення");
  assert.equal(saved.generatedAnalysis.lyrics[0].text, "Пісня");
  assert.equal(saved.revision, 3);
  assert.equal((await audio.getAnalysisJob(songId)).status, "partial");
  await assert.rejects(
    audio.saveManualAnalysis(songId, analysis, 2),
    /AnalysisRevisionConflict/
  );
  preferences.songs[songId] = { capo: 2, transpose: -1, shapes: { Dm: 3 } };
  await library.exportLibrary();
  const backup = JSON.parse(backupText);
  assert.equal(backup.version, 2);
  assert.equal(backup.audioIncluded, false);
  assert.equal(backup.audioPolicy, "relink-original-by-sha256");
  assert.equal(backupText.includes(metadata.fileName), false);
  const restored = library.parseLibraryBackup(backupText);
  assert.equal(
    restored.find((item) => item.audio).audio.analysis.lyrics[0].text,
    "Ручне виправлення"
  );
  assert.equal((await library.restoreLibrary(restored)).added, 0);
  await remove({ tableName: "songs", filters: `id = ${songId}` });
  assert.equal(await audio.getAudioSong(songId), null);
  assert.equal(await audio.getAnalysisJob(songId), null);
  const restoreResult = await library.restoreLibrary(restored);
  assert.equal(restoreResult.added, 1);
  const restoredAudio = (await audio.listAudioSongs())[0];
  assert.equal(restoredAudio.fileName, null);
  assert.equal(restoredAudio.manuallyEdited, true);
  await assert.rejects(
    audio.beginAnalysis(restoredAudio.songId, "http://127.0.0.1:8765"),
    /AudioFileMissing/
  );
  const relink = await audio.createAudioSong(metadata);
  assert.equal(relink.songId, restoredAudio.songId);
  assert.equal(relink.created, false);
  saved = await audio.getAudioSong(relink.songId);
  assert.equal(saved.fileName, metadata.fileName);
  assert.equal(saved.analysis.lyrics[0].text, "Ручне виправлення");
  await audio.acceptGeneratedAnalysis(relink.songId, saved.revision);
  saved = await audio.getAudioSong(relink.songId);
  assert.equal(saved.analysis.lyrics[0].text, "Пісня");
  assert.equal(saved.manuallyEdited, false);
  assert.equal(
    library.parseLibraryBackup(
      JSON.stringify({
        format: "freetune-library",
        version: 1,
        songs: [
          {
            title: "Old backup",
            content: "Am text",
            band_name: "",
            youtube_music: "",
            youtobe_lesson: "",
            preferences: {}
          }
        ]
      })
    ).length,
    1
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sqlite.close());
