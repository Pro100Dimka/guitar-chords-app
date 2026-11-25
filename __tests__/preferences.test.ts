jest.mock("../src/locales", () => ({ t: String, langs: [], languages: [] }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: String, i18n: { language: "en" } })
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));
jest.mock("../src/components/support", () => ({
  useSupport: { setState: jest.fn() }
}));
import React from "react";
import Renderer, { act } from "react-test-renderer";
import { Alert } from "react-native";
import Settings from "../src/screens/settings";
import { Action, Sheet } from "../src/screens/song/tools";
import { db } from "../src/components/database";
import { getAllItems } from "../src/components/database/crud";
import { FileSystem } from "react-native-file-access";
import ImageResizer from "@bam.tech/react-native-image-resizer";
import {
  saveDocuments,
  pick,
  keepLocalCopy
} from "@react-native-documents/picker";
import {
  exportLibrary,
  readLibraryFile,
  readSongCover,
  readRemoteSongCover,
  parseLibraryBackup,
  parseLibraryBackupAsync,
  restoreLibrary
} from "../src/components/library-files";
import {
  flushPreferences,
  loadPreferences,
  normalizeSongPreferences,
  usePreferences
} from "../src/components/preferences";
import { SQLTransaction } from "react-native-sqlite-2";
import { Tablature } from "../src/components/tablature";
import { defaultTabPractice } from "../src/components/tablature-practice";

jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));
jest.mock("../src/components/database/crud", () => ({
  getAllItems: jest.fn()
}));

const cover = "data:image/jpeg;base64,/9j/2Q==";
test.each([
  ["Akkords.pro", "https://akkords.pro/songs/kino/gruppa-krovi/"],
  ["Musicaccord.ru", "https://musicaccord.ru/songs/tnmk-granuli/"],
  ["Chords & Tabs", "https://www.chords-and-tabs.net/song/name/example-song"],
  ["Sonidos", "https://www.sonidos.com.br/example-performer/example-song"],
  ["WeingGuitar", "https://guitar.weingchicken.com/scores/1"],
  ["Akkords.fun", "https://akkords.fun/eng/example-performer/example-song/"],
  ["LalaTracker", "https://lalatracker.com/chords/example_performer/example-song"]
])("%s attribution survives preference normalization", (name, url) => {
  const contentSource = {
    name,
    url
  };
  expect(normalizeSongPreferences({ contentSource }).contentSource).toEqual(
    contentSource
  );
  expect(
    normalizeSongPreferences({
      contentSource: {
        ...contentSource,
        url: url.replace(
          new URL(url).hostname,
          `${new URL(url).hostname}.example.org`
        )
      }
    }).contentSource
  ).toBeUndefined();
});
const tabPractice = {
  ...defaultTabPractice(),
  metronome: true,
  countInBars: 2 as const,
  trainer: { enabled: true, startBpm: 60, targetBpm: 100, stepBpm: 5, repeats: 3 }
};
const tablature: Tablature = {
  version: 2,
  tempo: 92,
  beatsPerBar: 4,
  beatUnit: 4,
  barCount: 1,
  rests: [],
  notes: [
    { string: 0, fret: 0, tick: 0, duration: 24 },
    { string: 5, fret: 7, tick: 24, duration: 24 }
  ]
};

test.each(["resize", "readFile"])(
  "remote cover deadline includes stalled %s processing and cleans late results",
  async (stage) => {
    jest.mocked(FileSystem.fetchManaged).mockReturnValue({
      cancel: jest.fn().mockResolvedValue(undefined),
      result: Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: {},
        getHeader: () => undefined,
        redirected: false,
        url: "https://example.com/cover.jpg"
      })
    });
    const image = {
      uri: "file:///resized.jpg",
      path: "/resized.jpg",
      name: "resized.jpg",
      size: 100,
      width: 384,
      height: 384
    };
    let finish!: () => void;
    jest.mocked(ImageResizer.createResizedImage).mockImplementation(() =>
      stage === "resize"
        ? new Promise((resolve) => {
            finish = () => resolve(image);
          })
        : Promise.resolve(image)
    );
    jest.mocked(FileSystem.readFile).mockImplementation(() =>
      stage === "readFile"
        ? new Promise((resolve) => {
            finish = () => resolve("/9j/2Q==");
          })
        : Promise.resolve("/9j/2Q==")
    );
    jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
    let settled = false;
    const result = readRemoteSongCover(
      "https://example.com/cover.jpg",
      new AbortController().signal
    )
      .catch((error) => error)
      .finally(() => {
        settled = true;
      });
    for (let i = 0; i < 15; i++) await Promise.resolve();
    await jest.advanceTimersByTimeAsync(8000);
    try {
      expect(settled).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      finish();
      await result;
    }
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(FileSystem.unlink).toHaveBeenCalledWith(image.uri);
  }
);

test("simultaneous remote covers use independent temporary files", async () => {
  const clock = jest.spyOn(Date, "now").mockReturnValue(123);
  jest.mocked(FileSystem.fetchManaged).mockImplementation(() => ({
    cancel: jest.fn().mockResolvedValue(undefined),
    result: Promise.resolve({
      ok: false,
      status: 404,
      statusText: "Not found",
      headers: {},
      getHeader: () => undefined,
      redirected: false,
      url: ""
    })
  }));
  jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
  try {
    await Promise.all(
      ["a", "b"].map((name) =>
        readRemoteSongCover(
          `https://example.com/${name}.jpg`,
          new AbortController().signal
        )
      )
    );
    const paths = jest
      .mocked(FileSystem.fetchManaged)
      .mock.calls.map((call) => call[1]!.path);
    expect(new Set(paths).size).toBe(2);
  } finally {
    clock.mockRestore();
  }
});

test.each(["cancel", "timeout"])(
  "remote cover releases a stalled download on %s and removes its late file",
  async (exit) => {
    let finish!: (
      value: Awaited<ReturnType<typeof FileSystem.fetchManaged>["result"]>
    ) => void;
    const cancel = jest.fn().mockResolvedValue(undefined);
    jest.mocked(FileSystem.fetchManaged).mockReturnValue({
      cancel,
      result: new Promise((resolve) => {
        finish = resolve;
      })
    });
    jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
    const controller = new AbortController();
    let settled = false;
    const result = readRemoteSongCover(
      "https://example.com/cover.jpg",
      controller.signal
    )
      .catch((error) => error)
      .finally(() => {
        settled = true;
      });
    if (exit === "cancel") controller.abort();
    else await jest.advanceTimersByTimeAsync(8000);
    for (let i = 0; i < 15; i++) await Promise.resolve();
    expect(settled).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    await result;
    const path = jest.mocked(FileSystem.fetchManaged).mock.calls[0][1]!.path!;
    expect(FileSystem.unlink).toHaveBeenCalledWith(path);
    jest.mocked(FileSystem.unlink).mockClear();
    finish({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {},
      getHeader: () => undefined,
      redirected: false,
      url: "https://example.com/cover.jpg"
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(FileSystem.unlink).toHaveBeenCalledWith(path);
    expect(ImageResizer.createResizedImage).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  }
);

test.each(["{broken", "null", "[]"])(
  "corrupted global preferences still load healthy song chunks: %s",
  async (value) => {
    jest.mocked(getAllItems).mockImplementation(async (query) => {
      if (query.fields === "length(value) AS length")
        return [{ length: value.length }];
      if (query.parameters?.[0] === "experience") return [{ value }];
      return [
        { key: "song:9:0", value: JSON.stringify({ tempo: 123, capo: 3 }) }
      ];
    });
    await loadPreferences();
    expect(usePreferences.getState().songs[9]).toMatchObject({
      tempo: 123,
      capo: 3
    });
    expect(usePreferences.getState().saveError).toBe(true);
  }
);

test.each(["legacy", "chunk"])(
  "a damaged stored score is never silently discarded during %s load",
  async (kind) => {
    const damaged = {
      tempo: 123,
      tablature: { ...tablature, notes: [{ tick: 0, string: 0, fret: 99 }] }
    };
    const legacy = JSON.stringify(
      kind === "legacy" ? { songs: { 17: damaged } } : {}
    );
    jest.mocked(getAllItems).mockImplementation(async (query) => {
      if (query.fields === "length(value) AS length")
        return [{ length: legacy.length }];
      if (query.parameters?.[0] === "experience") return [{ value: legacy }];
      return kind === "chunk"
        ? [{ key: "song:17:0", value: JSON.stringify(damaged) }]
        : [];
    });
    await expect(loadPreferences()).rejects.toThrow("PreferenceReadFailed");
    expect(usePreferences.getState().songs).toEqual({});
    expect(usePreferences.getState().saveError).toBe(true);
    expect(db.transaction).not.toHaveBeenCalled();
  }
);

test.each(["null", "[]", "123"])(
  "a valid JSON primitive is not accepted as a stored song preference: %s",
  async (value) => {
    jest.mocked(getAllItems).mockImplementation(async (query) =>
      query.parameters?.[0] === "song:%"
        ? [{ key: "song:17:0", value }]
        : []
    );
    await expect(loadPreferences()).rejects.toThrow("PreferenceReadFailed");
    expect(usePreferences.getState().saveError).toBe(true);
    expect(db.transaction).not.toHaveBeenCalled();
  }
);

test("a valid 38-cover library exports completely in individually restorable parts", async () => {
  const image =
    "data:image/jpeg;base64," +
    require("node:fs")
      .readFileSync(
        require("node:path").resolve("__tests__/fixtures/cover-384.jpg")
      )
      .toString("base64");
  expect(image.length).toBeLessThan(300000);
  const songs = Array.from({ length: 38 }, (_, i) => ({
    id: i + 1,
    title: `Song ${i}`,
    content: "Am\nWords",
    band_name: "Artist",
    youtube_music: "",
    youtobe_lesson: ""
  }));
  usePreferences.setState({ songs: {} });
  for (const song of songs)
    usePreferences
      .getState()
      .updateSong(song.id, { cover: image, capo: 2, shapes: { Am: 1 } });
  jest.mocked(getAllItems).mockResolvedValue(songs);
  const files = new Map<string, string>();
  jest.mocked(FileSystem.writeFile).mockImplementation(async (path, text) => {
    files.set(path, text);
  });
  jest.mocked(FileSystem.stat).mockImplementation(
    async (path) =>
      ({
        size: require("node:buffer").Buffer.byteLength(files.get(path)!, "utf8")
      }) as Awaited<ReturnType<typeof FileSystem.stat>>
  );
  jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
  jest
    .mocked(saveDocuments)
    .mockResolvedValue([
      { uri: "content://backup/part.json", name: "part.json", error: null }
    ]);
  const exporting = exportLibrary();
  await jest.advanceTimersByTimeAsync(1000);
  await exporting;
  expect(jest.mocked(saveDocuments).mock.calls.length).toBeGreaterThan(1);
  const restored = [...files.values()].flatMap((text) => {
    expect(
      require("node:buffer").Buffer.byteLength(text, "utf8")
    ).toBeLessThanOrEqual(5 * 1024 * 1024);
    return parseLibraryBackup(text);
  });
  expect(restored.map((song) => song.title)).toEqual(
    songs.map((song) => song.title)
  );
  expect(
    restored.every(
      (song) => song.preferences.cover === image && song.preferences.capo === 2
    )
  ).toBe(true);
  expect(FileSystem.unlink).toHaveBeenCalledTimes(files.size);
});
beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
    body({ executeSql: jest.fn() });
    success?.();
  });
  usePreferences.setState({ songs: {}, saveError: false });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.resetAllMocks();
});

test("song preferences and cover survive serialization and reload; failed commits remain visible", async () => {
  const saved = new Map<string, string>();
  let fail = true;
  jest.mocked(db.transaction).mockImplementation((body, error, success) => {
    body({
      executeSql: (_sql, args) => {
        if (args?.[1]) saved.set(String(args[0]), String(args[1]));
      }
    });
    if (fail) error?.(Object.assign(new Error("disk full"), { code: 1 }));
    else success?.();
  });
  usePreferences.getState().updateSong(17, {
    tablature,
    tabPractice,
    cover,
    favorite: true,
    position: 125,
    shapes: { F: 3 },
    tempo: 92
  });
  flushPreferences();
  expect(usePreferences.getState().saveError).toBe(true);
  fail = false;
  flushPreferences();
  expect(usePreferences.getState().saveError).toBe(false);
  usePreferences.setState({ songs: {} });
  jest.mocked(getAllItems).mockImplementation(async (query) => {
    const value = saved.get("experience")!;
    if (query.fields?.startsWith("length")) return [{ length: value.length }];
    if (query.fields?.startsWith("substr")) return [{ value }];
    return [...saved.entries()]
      .filter(([key]) => key.startsWith("song:"))
      .map(([key, value]) => ({ key, value }));
  });
  await loadPreferences();
  expect(usePreferences.getState().songs[17]).toMatchObject({
    tablature,
    tabPractice,
    cover,
    favorite: true,
    position: 125,
    shapes: { F: 3 },
    tempo: 92
  });
});

test.each([
  [undefined, 1],
  ["large", 1],
  [0.2, 1],
  [9, 1.5],
  [1.27, 1.27]
])(
  "saved guitar zoom %s loads as the bounded value %s",
  async (savedZoom, expected) => {
    const text = JSON.stringify({ playGuitarZoom: savedZoom });
    jest.mocked(getAllItems).mockImplementation(async (query) => {
      if (query.fields?.startsWith("length")) return [{ length: text.length }];
      if (query.fields?.startsWith("substr")) return [{ value: text }];
      return [];
    });
    await loadPreferences();
    expect(usePreferences.getState().playGuitarZoom).toBe(expected);
  }
);

test("a settled guitar size is serialized and restored", async () => {
  let text = "";
  jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
    body({
      executeSql: (_sql, args) => {
        if (args?.[0] === "experience") text = String(args[1]);
      }
    });
    success?.();
  });
  usePreferences.getState().update({ playGuitarZoom: 1.31 });
  await flushPreferences();
  expect(JSON.parse(text).playGuitarZoom).toBe(1.31);
  usePreferences.setState({ playGuitarZoom: 1 });
  jest.mocked(getAllItems).mockImplementation(async (query) => {
    if (query.fields?.startsWith("length")) return [{ length: text.length }];
    if (query.fields?.startsWith("substr")) return [{ value: text }];
    return [];
  });
  await loadPreferences();
  expect(usePreferences.getState().playGuitarZoom).toBe(1.31);
});

test("exported backup retains artist, lyrics, cover and chord shapes", async () => {
  const contentSource = {
    name: "GuitareTab",
    url: "https://www.guitaretab.com/e/eagles/286856.html"
  };
  usePreferences
    .getState()
    .updateSong(17, {
      cover, shapes: { Am: 2 }, contentSource, tablature, tabPractice
    });
  jest.mocked(getAllItems).mockResolvedValue([
    {
      id: 17,
      title: "Song",
      band_name: "Artist",
      content: "Am C\nWords",
      youtube_music: null,
      youtobe_lesson: null
    }
  ]);
  jest.mocked(FileSystem.writeFile).mockResolvedValue(undefined);
  jest
    .mocked(FileSystem.stat)
    .mockResolvedValue({ size: 1000 } as Awaited<
      ReturnType<typeof FileSystem.stat>
    >);
  jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
  jest.mocked(saveDocuments).mockResolvedValue([
    {
      uri: "content://backup/library.json",
      name: "library.json",
      error: null
    }
  ]);
  await exportLibrary();
  const [, text] = jest.mocked(FileSystem.writeFile).mock.calls[0];
  const restored = parseLibraryBackup(text);
  expect(restored[0]).toMatchObject({
    title: "Song",
    band_name: "Artist",
    content: "Am C\nWords",
    preferences: { cover, shapes: { Am: 2 }, contentSource, tablature, tabPractice }
  });
  expect(FileSystem.unlink).toHaveBeenCalledTimes(1);
  expect(() => parseLibraryBackup('{"format":"broken"}')).toThrow(
    "BackupInvalid"
  );
});

test("backup restores expressive score settings and short note values", () => {
  const score = { ...tablature, version: 3, notes: [{ string: 5, fret: 5, tick: 0.75, duration: 1.5, velocity: 82, techniques: ["bend", "vibrato"], bend: 1.5, voice: 2 }] };
  const restored = parseLibraryBackup(JSON.stringify({ format: "freetune-library", version: 2, songs: [{
    title: "Riff", content: "Saved tab", band_name: "", youtube_music: "", youtobe_lesson: "", preferences: { tablature: score }
  }] }));
  expect(restored[0].preferences?.tablature).toEqual(score);
});

test.each([
  null,
  { ...tablature, version: 4 },
  { ...tablature, notes: [{ string: 6, fret: 0, tick: 0 }] },
  { ...tablature, notes: [{ string: 0, fret: 0, tick: -1 }] }
])(
  "backup rejects explicit malformed tablature instead of dropping it: %j",
  (invalid) => {
    expect(() =>
      parseLibraryBackup(
        JSON.stringify({
          format: "freetune-library",
          version: 2,
          songs: [
            {
              title: "Riff",
              content: "Saved tab",
              band_name: "",
              youtube_music: "",
              youtobe_lesson: "",
              preferences: { tablature: invalid }
            }
          ]
        })
      )
    ).toThrow("BackupInvalid");
  }
);

test("export refuses invalid tablature before reporting a successful backup", async () => {
  usePreferences.getState().updateSong(17, {
    tablature: { ...tablature, version: 4 } as unknown as Tablature
  });
  jest.mocked(getAllItems).mockResolvedValue([
    {
      id: 17,
      title: "Invalid riff",
      content: "Saved tab",
      band_name: "",
      youtube_music: "",
      youtobe_lesson: ""
    }
  ]);
  await expect(exportLibrary()).rejects.toThrow("BackupInvalid");
  expect(FileSystem.writeFile).not.toHaveBeenCalled();
});

test.each([false, true])(
  "restoration publishes imported preferences only after a successful commit (failure: %s)",
  async (fail) => {
    usePreferences.getState().updateSong(9, { favorite: true, tempo: 92 });
    const original = { ...usePreferences.getState().songs };
    flushPreferences();
    const songs = parseLibraryBackup(
      JSON.stringify({
        format: "freetune-library",
        version: 1,
        songs: [
          {
            title: "Imported",
            content: "Am C\nWords",
            band_name: "",
            youtube_music: "",
            youtobe_lesson: "",
            preferences: { cover, favorite: true, shapes: { Am: 2 } }
          }
        ]
      })
    );
    const executeSql: SQLTransaction["executeSql"] = jest.fn(
      (sql, args, success) => {
        success?.(
          { executeSql },
          {
            insertId: 42,
            rowsAffected: 1,
            rows: { length: 0, item: () => undefined }
          }
        );
      }
    );
    jest.mocked(db.transaction).mockImplementation((body) => {
      body({ executeSql });
    });
    const pending = restoreLibrary(songs);
    expect(usePreferences.getState().songs).toEqual(original);
    const commit = jest.mocked(db.transaction).mock.calls.at(-1)!;
    const write = jest
      .mocked(executeSql)
      .mock.calls.filter(([sql]) => sql.startsWith("INSERT OR REPLACE"))
      .at(-1)!;
    expect(JSON.parse(String(write[1]?.[1]))).toMatchObject({
      cover,
      favorite: true,
      shapes: { Am: 2 }
    });
    if (fail) {
      const error = Object.assign(new Error("disk full"), { code: 1 });
      commit[1]?.(error);
      await expect(pending).rejects.toBe(error);
      expect(usePreferences.getState().songs).toEqual(original);
    } else {
      commit[2]?.();
      await expect(pending).resolves.toEqual({ added: 1, skipped: 0 });
      expect(usePreferences.getState().songs[42]).toMatchObject({
        cover,
        favorite: true,
        shapes: { Am: 2 }
      });
    }
  }
);

test("restoring a backup preserves song settings changed while its commit is pending", async () => {
  usePreferences.getState().updateSong(42, { tempo: 80, favorite: false });
  await flushPreferences();
  const songs = parseLibraryBackup(
    JSON.stringify({
      format: "freetune-library",
      version: 2,
      songs: [
        {
          title: "Song",
          content: "Am\nWords",
          band_name: "",
          youtube_music: "",
          youtobe_lesson: "",
          preferences: { tempo: 90, favorite: false, capo: 2 }
        }
      ]
    })
  );
  const writes: string[] = [];
  const executeSql: SQLTransaction["executeSql"] = (sql, args, success) => {
    if (args?.[0] === "song:42:0") writes.push(String(args[1]));
    const rows = sql.startsWith("SELECT songs.id") ? [{ id: 42 }] : [];
    success?.(
      { executeSql },
      {
        rows: { length: rows.length, item: (i) => rows[i] },
        rowsAffected: 1,
        insertId: 42
      }
    );
  };
  let finish!: () => void;
  jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
    body({ executeSql });
    success?.();
  });
  jest
    .mocked(db.transaction)
    .mockImplementationOnce((body, _error, success) => {
      body({ executeSql });
      finish = () => success?.();
    });
  const restore = restoreLibrary(songs);
  usePreferences.getState().updateSong(42, { tempo: 125, favorite: true });
  finish();
  await expect(restore).resolves.toEqual({ added: 0, skipped: 1 });
  expect(usePreferences.getState().songs[42]).toMatchObject({
    tempo: 125,
    favorite: true,
    capo: 2
  });
  await flushPreferences();
  expect(JSON.parse(writes.at(-1)!)).toMatchObject({
    tempo: 125,
    favorite: true,
    capo: 2
  });
});

test("many covers never create a single oversized settings row", () => {
  const writes: string[] = [];
  jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
    body({
      executeSql: (_sql, args) => {
        if (args?.[1]) writes.push(String(args[1]));
      }
    });
    success?.();
  });
  for (let id = 1; id <= 144; id++)
    usePreferences
      .getState()
      .updateSong(id, { cover: "data:image/jpeg;base64," + "a".repeat(15000) });
  flushPreferences();
  expect(Math.max(...writes.map((x) => x.length))).toBeLessThan(400000);
  expect(writes.filter((x) => x.includes("data:image/jpeg"))).toHaveLength(144);
});

test("existing oversized backup fields remain exportable and restorable", async () => {
  jest.mocked(getAllItems).mockResolvedValue([
    {
      id: 1,
      title: "a".repeat(1001),
      content: "Am\nWords",
      band_name: "",
      youtube_music: "",
      youtobe_lesson: ""
    }
  ]);
  jest
    .mocked(FileSystem.stat)
    .mockResolvedValue({ size: 2000 } as Awaited<
      ReturnType<typeof FileSystem.stat>
    >);
  jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
  jest
    .mocked(saveDocuments)
    .mockResolvedValue([
      { uri: "content://backup", name: "backup.json", error: null }
    ]);
  await exportLibrary();
  expect(
    parseLibraryBackup(jest.mocked(FileSystem.writeFile).mock.calls[0][1])[0]
      .title
  ).toHaveLength(1001);
});

test.each([false, true])(
  "large legacy preferences migrate in bounded reads and publish only on commit (failure: %s)",
  async (fail) => {
    const legacy = JSON.stringify({
      instrument: "chromatic",
      songs: Object.fromEntries(
        Array.from({ length: 144 }, (_, i) => [
          i + 1,
          {
            cover: "data:image/jpeg;base64," + "a".repeat(15000),
            favorite: true,
            capo: 2
          }
        ])
      )
    });
    expect(legacy.length).toBeGreaterThan(2 * 1024 * 1024);
    jest.mocked(getAllItems).mockImplementation(async (query) => {
      if (query.fields === "length(value) AS length")
        return [{ length: legacy.length }];
      const match = query.fields?.match(
        /^substr\(value, (\d+), 65536\) AS value$/
      );
      if (match)
        return [
          {
            value: legacy.slice(
              Number(match[1]) - 1,
              Number(match[1]) - 1 + 65536
            )
          }
        ];
      if (query.parameters?.[0] === "song:%") return [];
      throw new Error("Oversized CursorWindow read");
    });
    const writes: unknown[][] = [];
    jest.mocked(db.transaction).mockImplementation((body, error, success) => {
      body({
        executeSql: (_sql, args) => {
          if (args) writes.push(args);
        }
      });
      if (fail) error?.(Object.assign(new Error("disk full"), { code: 1 }));
      else success?.();
    });
    const loading = loadPreferences();
    const checked = fail
      ? expect(loading).rejects.toThrow("disk full")
      : expect(loading).resolves.toBeUndefined();
    await jest.advanceTimersByTimeAsync(1000);
    await checked;
    if (fail) {
      expect(usePreferences.getState().songs).toEqual({});
    } else {
      expect(Object.keys(usePreferences.getState().songs)).toHaveLength(144);
      expect(usePreferences.getState().songs[144]).toMatchObject({
        favorite: true,
        capo: 2
      });
      expect(
        writes.filter((args) => /^song:\d+:\d+$/.test(String(args[0])))
      ).toHaveLength(144);
      expect(
        String(writes.find((args) => args[0] === "experience")?.[1])
      ).not.toContain("data:image");
    }
  }
);

test("backup rejects a single text row too large for bounded SQLite reads", () => {
  expect(() =>
    parseLibraryBackup(
      JSON.stringify({
        format: "freetune-library",
        version: 1,
        songs: [
          {
            title: "Title",
            content: "a".repeat(400001),
            band_name: "",
            youtube_music: "",
            youtobe_lesson: "",
            preferences: {}
          }
        ]
      })
    )
  ).toThrow("BackupInvalid");
});

test("song chunks load even when the global experience row is absent", async () => {
  jest
    .mocked(getAllItems)
    .mockImplementation(async (query) =>
      query.filters === "key LIKE ?"
        ? [{ key: "song:17:0", value: JSON.stringify({ tempo: 123, capo: 3 }) }]
        : []
    );
  await loadPreferences();
  expect(usePreferences.getState().songs[17]).toMatchObject({
    tempo: 123,
    capo: 3
  });
});

test("preference flushes serialize pending transactions and save the latest revision", () => {
  const commits: (() => void)[] = [];
  jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
    body({ executeSql: jest.fn() });
    commits.push(() => success?.());
  });
  usePreferences.getState().updateSong(17, { tempo: 90 });
  flushPreferences();
  usePreferences.getState().updateSong(17, { tempo: 120 });
  flushPreferences();
  expect(commits).toHaveLength(1);
  commits[0]();
  expect(commits).toHaveLength(2);
  commits[1]();
  flushPreferences();
  expect(commits).toHaveLength(2);
  expect(usePreferences.getState().songs[17].tempo).toBe(120);
});

test("modern backups enforce each field limit and legacy oversized records remain recoverable", () => {
  const song = {
    title: "Title",
    content: "Am\nWords",
    band_name: "Artist",
    youtube_music: "",
    youtobe_lesson: "",
    preferences: {}
  };
  const encode = (version: number, patch: object) =>
    JSON.stringify({
      format: "freetune-library",
      version,
      songs: [{ ...song, ...patch }]
    });
  expect(parseLibraryBackup(encode(2, {}))).toHaveLength(1);
  for (const [key, length] of Object.entries({
    title: 1001,
    band_name: 1001,
    content: 200001,
    youtube_music: 4001,
    youtobe_lesson: 4001
  }))
    expect(() =>
      parseLibraryBackup(encode(2, { [key]: "x".repeat(length) }))
    ).toThrow("BackupInvalid");
  expect(
    parseLibraryBackup(encode(1, { band_name: "x".repeat(1001) }))[0].band_name
  ).toHaveLength(1001);
});

test("a failed pending preference save remains retryable with the newest values", async () => {
  const calls: Parameters<typeof db.transaction>[] = [];
  jest.mocked(db.transaction).mockImplementation((...args) => {
    calls.push(args);
  });
  usePreferences.getState().updateSong(17, { tempo: 90 });
  const first = flushPreferences();
  usePreferences.getState().updateSong(17, { tempo: 123 });
  flushPreferences();
  expect(calls).toHaveLength(1);
  calls[0][1]?.(Object.assign(new Error("disk full"), { code: 1 }));
  await first;
  expect(usePreferences.getState().saveError).toBe(true);
  const second = flushPreferences();
  const writes: string[] = [];
  calls[1][0]({
    executeSql: (_sql, args) => {
      if (args?.[1]) writes.push(String(args[1]));
    }
  });
  expect(writes.some((text) => text.includes('"tempo":123'))).toBe(true);
  calls[1][2]?.();
  await second;
  expect(usePreferences.getState().saveError).toBe(false);
});

test("a synchronous database failure releases the preference save lock", async () => {
  jest.mocked(db.transaction).mockImplementationOnce(() => {
    throw new Error("Database closed");
  });
  usePreferences.getState().updateSong(17, { tempo: 119 });
  await expect(flushPreferences()).resolves.toBeUndefined();
  expect(usePreferences.getState().saveError).toBe(true);
  usePreferences.getState().updateSong(17, { tempo: 120 });
  await expect(flushPreferences()).resolves.toBeUndefined();
  expect(db.transaction).toHaveBeenCalledTimes(2);
  expect(usePreferences.getState().saveError).toBe(false);
});

const fileMetadata = {
  error: null,
  type: null,
  nativeType: null,
  isVirtual: false,
  convertibleToMimeTypes: null,
  hasRequestedType: true
};

test("exported Unicode backup survives real file reading and restoration", async () => {
  const content = "[Am]Hello � world 🎵\nПривіт 世界";
  const files = new Map<string, string>();
  const inserted: unknown[][] = [];
  jest.mocked(getAllItems).mockResolvedValue([
    {
      id: 1,
      title: "Unicode",
      content,
      band_name: "",
      youtube_music: "",
      youtobe_lesson: ""
    }
  ]);
  jest.mocked(FileSystem.writeFile).mockImplementation(async (path, text) => {
    files.set(path, text);
  });
  jest
    .mocked(FileSystem.stat)
    .mockResolvedValue({ size: 1000 } as Awaited<
      ReturnType<typeof FileSystem.stat>
    >);
  jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
  jest
    .mocked(saveDocuments)
    .mockResolvedValue([
      {
        ...fileMetadata,
        uri: "content://backup.json",
        name: "backup.json",
        error: null
      }
    ]);
  await exportLibrary();
  const text = [...files.values()][0];
  jest
    .mocked(pick)
    .mockResolvedValue([
      {
        ...fileMetadata,
        uri: "content://backup.json",
        name: "backup.json",
        size: 1000
      }
    ]);
  jest.mocked(keepLocalCopy).mockResolvedValue([
    {
      status: "success",
      localUri: "file:///backup.json",
      sourceUri: "content://backup.json"
    }
  ]);
  jest
    .mocked(FileSystem.readFile)
    .mockImplementation(async (_path, encoding) =>
      encoding === "base64"
        ? require("node:buffer").Buffer.from(text, "utf8").toString("base64")
        : text
    );
  const read = await readLibraryFile("backup");
  const songs = parseLibraryBackup(read.text);
  jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
    const tx: SQLTransaction = {
      executeSql: (sql, args, done) => {
        if (sql.startsWith("INSERT INTO songs")) inserted.push(args ?? []);
        done?.(tx, {
          insertId: 10,
          rowsAffected: 1,
          rows: { length: 0, item: jest.fn() }
        });
      }
    };
    body(tx);
    success?.();
  });
  await expect(restoreLibrary(songs)).resolves.toMatchObject({ added: 1 });
  expect(inserted[0]).toContain(content);
});

test.each(["close", "back", "timeout"])(
  "cloud backup reading can end safely through %s",
  async (exit) => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    let finish!: (value: Awaited<ReturnType<typeof keepLocalCopy>>) => void;
    jest
      .mocked(pick)
      .mockResolvedValue([
        {
          ...fileMetadata,
          uri: "content://backup.json",
          name: "backup.json",
          size: 1000
        }
      ]);
    jest.mocked(keepLocalCopy).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
    jest
      .mocked(FileSystem.stat)
      .mockResolvedValue({ size: 1000 } as Awaited<
        ReturnType<typeof FileSystem.stat>
      >);
    jest
      .mocked(FileSystem.readFile)
      .mockResolvedValue(
        JSON.stringify({ format: "freetune-library", version: 2, songs: [] })
      );
    let screen!: Renderer.ReactTestRenderer;
    await act(async () => {
      screen = Renderer.create(React.createElement(Settings));
    });
    try {
      const open = async () =>
        act(async () =>
          screen.root
            .findAll(
              (node) =>
                typeof node.props.onPress === "function" &&
                node.findAll(
                  (child) => child.props.children === "LibraryBackup"
                ).length > 0
            )[0]
            .props.onPress()
        );
      await open();
      await act(async () => {
        screen.root
          .findAllByType(Action)
          .find((node) => node.props.label === "RestoreLibrary")!
          .props.onPress();
      });
      if (exit === "timeout") {
        await act(async () => {
          await jest.advanceTimersByTimeAsync(60000);
        });
        expect(
          screen.root
            .findAllByType(Action)
            .filter((node) =>
              ["RestoreLibrary", "ExportLibrary"].includes(node.props.label)
            )
            .every((node) => !node.props.disabled)
        ).toBe(true);
      } else {
        await act(async () => {
          if (exit === "back")
            screen.root
              .findAll(
                (node) => typeof node.props.onRequestClose === "function"
              )[0]
              .props.onRequestClose();
          else
            screen.root
              .findAllByType(Action)
              .find((node) => node.props.label === "Close")!
              .props.onPress();
        });
        expect(screen.root.findAllByType(Sheet)).toHaveLength(0);
        await open();
      }
      jest.mocked(db.transaction).mockClear();
      await act(async () =>
        finish([
          {
            status: "success",
            sourceUri: "content://backup.json",
            localUri: "file:///late-backup.json"
          }
        ])
      );
      expect(db.transaction).not.toHaveBeenCalled();
      expect(
        screen.root
          .findAllByType(Action)
          .some((node) => node.props.label === "RestoreConfirm")
      ).toBe(false);
      expect(FileSystem.unlink).toHaveBeenCalledWith(
        "file:///late-backup.json"
      );
      if (exit !== "timeout") expect(alert).not.toHaveBeenCalled();
    } finally {
      await act(async () => screen.unmount());
      jest.restoreAllMocks();
    }
  }
);

test.each([
  [0x80],
  [0xc0, 0xaf],
  [0xc2],
  [0xc2, 0x41],
  [0xe0, 0x80, 0x80],
  [0xed, 0xa0, 0x80],
  [0xe2, 0x82],
  [0xf0, 0x80, 0x80, 0x80],
  [0xf4, 0x90, 0x80, 0x80],
  [0xf5, 0x80, 0x80, 0x80]
])("text import rejects malformed UTF-8 bytes: %j", async (...bytes) => {
  const data = require("node:buffer").Buffer.from(bytes);
  jest
    .mocked(pick)
    .mockResolvedValue([
      {
        ...fileMetadata,
        uri: "content://bad.txt",
        name: "bad.txt",
        size: data.length
      }
    ]);
  jest.mocked(keepLocalCopy).mockResolvedValue([
    {
      status: "success",
      sourceUri: "content://bad.txt",
      localUri: "file:///bad.txt"
    }
  ]);
  jest
    .mocked(FileSystem.stat)
    .mockResolvedValue({ size: data.length } as Awaited<
      ReturnType<typeof FileSystem.stat>
    >);
  jest
    .mocked(FileSystem.readFile)
    .mockImplementation(async (_path, encoding) => data.toString(encoding));
  jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
  await expect(readLibraryFile("song")).rejects.toThrow("FileEncodingError");
  expect(FileSystem.unlink).toHaveBeenCalledWith("file:///bad.txt");
});

test("already-cancelled file reading never opens the picker", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    readLibraryFile("backup", controller.signal)
  ).rejects.toMatchObject({ code: "cancelled" });
  expect(pick).not.toHaveBeenCalled();
});

test.each(["cancel", "timeout"])(
  "cover processing releases a pending resize after %s and removes its late result",
  async (exit) => {
    let finish!: (
      image: Awaited<ReturnType<typeof ImageResizer.createResizedImage>>
    ) => void;
    jest.mocked(ImageResizer.createResizedImage).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
    const controller = new AbortController();
    const result = readSongCover(
      "file:///original.jpg",
      false,
      controller.signal
    ).catch((error) => error);
    if (exit === "cancel") controller.abort();
    else await jest.advanceTimersByTimeAsync(30000);
    expect(await result).toMatchObject(
      exit === "cancel" ? { code: "cancelled" } : { message: "FileReadError" }
    );
    finish({
      uri: "file:///late-resized.jpg",
      path: "/late-resized.jpg",
      name: "late-resized.jpg",
      size: 100,
      width: 384,
      height: 384
    });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(FileSystem.unlink).toHaveBeenCalledWith("file:///late-resized.jpg");
    expect(FileSystem.unlink).not.toHaveBeenCalledWith("file:///original.jpg");
    expect(FileSystem.readFile).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  }
);

test.each(["stat", "readFile"] as const)(
  "backup cancellation interrupts a pending %s and cleans its local copy",
  async (stage) => {
    jest
      .mocked(pick)
      .mockResolvedValue([
        {
          ...fileMetadata,
          uri: "content://backup.json",
          name: "backup.json",
          size: 1000
        }
      ]);
    jest.mocked(keepLocalCopy).mockResolvedValue([
      {
        status: "success",
        localUri: "file:///pending.json",
        sourceUri: "content://backup.json"
      }
    ]);
    jest
      .mocked(FileSystem.stat)
      .mockResolvedValue({ size: 1000 } as Awaited<
        ReturnType<typeof FileSystem.stat>
      >);
    jest.mocked(FileSystem.readFile).mockReturnValue(new Promise(() => {}));
    if (stage === "stat")
      jest.mocked(FileSystem.stat).mockReturnValue(new Promise(() => {}));
    jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
    const controller = new AbortController();
    const result = readLibraryFile("backup", controller.signal).catch(
      (error) => error
    );
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(FileSystem[stage]).toHaveBeenCalled();
    controller.abort();
    expect(await result).toMatchObject({ code: "cancelled" });
    expect(FileSystem.unlink).toHaveBeenCalledWith("file:///pending.json");
  }
);

test("valid UTF-8 boundaries, BOM, Unicode and line endings remain readable", async () => {
  const words =
    "�" +
    String.fromCodePoint(
      0x7f,
      0x80,
      0x7ff,
      0x800,
      0xd7ff,
      0xe000,
      0xffff,
      0x10000,
      0x10ffff
    );
  const source = "\uFEFF[Am]" + words + "\r\nNext\rLine";
  const bytes = require("node:buffer").Buffer.from(source, "utf8");
  jest
    .mocked(pick)
    .mockResolvedValue([
      {
        ...fileMetadata,
        uri: "content://valid.txt",
        name: "valid.txt",
        size: bytes.length
      }
    ]);
  jest.mocked(keepLocalCopy).mockResolvedValue([
    {
      status: "success",
      localUri: "file:///valid.txt",
      sourceUri: "content://valid.txt"
    }
  ]);
  jest
    .mocked(FileSystem.stat)
    .mockResolvedValue({ size: bytes.length } as Awaited<
      ReturnType<typeof FileSystem.stat>
    >);
  jest
    .mocked(FileSystem.readFile)
    .mockImplementation(async (_path, encoding) => bytes.toString(encoding));
  jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
  await expect(readLibraryFile("song")).resolves.toEqual({
    name: "valid.txt",
    text: "[Am]" + words + "\nNext\nLine"
  });
});

test("closing the backup sheet stays blocked during the restore transaction", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  const text = JSON.stringify({
    format: "freetune-library",
    version: 2,
    songs: [
      {
        title: "Imported",
        content: "[Am]Words",
        band_name: "",
        youtube_music: "",
        youtobe_lesson: ""
      }
    ]
  });
  jest
    .mocked(pick)
    .mockResolvedValue([
      {
        ...fileMetadata,
        uri: "content://backup.json",
        name: "backup.json",
        size: 1000
      }
    ]);
  jest.mocked(keepLocalCopy).mockResolvedValue([
    {
      status: "success",
      localUri: "file:///backup.json",
      sourceUri: "content://backup.json"
    }
  ]);
  jest
    .mocked(FileSystem.stat)
    .mockResolvedValue({ size: 1000 } as Awaited<
      ReturnType<typeof FileSystem.stat>
    >);
  jest
    .mocked(FileSystem.readFile)
    .mockImplementation(async (_path, encoding) =>
      encoding === "base64"
        ? require("node:buffer").Buffer.from(text).toString("base64")
        : text
    );
  jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
  let screen!: Renderer.ReactTestRenderer;
  await act(async () => {
    screen = Renderer.create(React.createElement(Settings));
  });
  try {
    await act(async () =>
      screen.root
        .findAll(
          (node) =>
            typeof node.props.onPress === "function" &&
            node.findAll((child) => child.props.children === "LibraryBackup")
              .length > 0
        )[0]
        .props.onPress()
    );
    await act(async () => {
      screen.root
        .findAllByType(Action)
        .find((node) => node.props.label === "RestoreLibrary")!
        .props.onPress();
    });
    await act(async () => jest.advanceTimersByTimeAsync(50));
    let commit!: () => void;
    jest.mocked(db.transaction).mockImplementation((body, _error, success) => {
      const tx: SQLTransaction = {
        executeSql: (_sql, _args, done) =>
          done?.(tx, {
            insertId: 1,
            rowsAffected: 1,
            rows: { length: 0, item: jest.fn() }
          })
      };
      body(tx);
      commit = () => success?.();
    });
    await act(async () => {
      screen.root
        .findAllByType(Action)
        .find((node) => node.props.label === "RestoreConfirm")!
        .props.onPress();
    });
    await act(async () =>
      screen.root
        .findAllByType(Action)
        .find((node) => node.props.label === "Close")!
        .props.onPress()
    );
    expect(screen.root.findAllByType(Sheet)).toHaveLength(1);
    expect(alert).not.toHaveBeenCalled();
    await act(async () => commit());
    expect(alert).toHaveBeenCalledWith("RestoreDone", "RestoreResult");
    await act(async () =>
      screen.root
        .findAllByType(Action)
        .find((node) => node.props.label === "Close")!
        .props.onPress()
    );
    expect(screen.root.findAllByType(Sheet)).toHaveLength(0);
  } finally {
    await act(async () => screen.unmount());
    jest.restoreAllMocks();
  }
});

test("unchanged preferences do not notify screens or rewrite stored songs", async () => {
  const state = usePreferences.getState();
  state.updateSong(17, { tempo: 92, position: 125 });
  await flushPreferences();
  jest.mocked(db.transaction).mockClear();
  const snapshot = usePreferences.getState();
  const notify = jest.fn();
  const unsubscribe = usePreferences.subscribe(notify);
  try {
    snapshot.update({ tab: snapshot.tab, tuning: snapshot.tuning });
    snapshot.updateSong(17, { tempo: 92, position: 125 });
    snapshot.removeSong(99999);
    jest.runOnlyPendingTimers();
    await flushPreferences();
    expect(usePreferences.getState()).toBe(snapshot);
    expect(notify).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
  }
});

function mockImportBytes(bytes: Uint8Array) {
  const data = require("node:buffer").Buffer.from(bytes);
  jest.mocked(pick).mockResolvedValue([
    {
      ...fileMetadata,
      uri: "content://large.txt",
      name: "large.txt",
      size: data.length
    }
  ]);
  jest.mocked(keepLocalCopy).mockResolvedValue([
    {
      status: "success",
      sourceUri: "content://large.txt",
      localUri: "file:///large.txt"
    }
  ]);
  jest.mocked(FileSystem.stat).mockResolvedValue({
    size: data.length
  } as Awaited<ReturnType<typeof FileSystem.stat>>);
  jest.mocked(FileSystem.readFile).mockImplementation(async (_path, encoding) =>
    data.toString(encoding)
  );
  jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
}

test.each(["é", "€", "🎵"])(
  "UTF-8 validation preserves %s split across decode chunks",
  async (character) => {
    const source = "a".repeat(49151) + character + "\r\nПривіт";
    mockImportBytes(require("node:buffer").Buffer.from(source, "utf8"));
    const reading = readLibraryFile("song");
    await jest.advanceTimersByTimeAsync(50);
    await expect(reading).resolves.toEqual({
      text: source.replace("\r\n", "\n"),
      name: "large.txt"
    });
    expect(jest.getTimerCount()).toBe(0);
  }
);

test.each([
  [0xc2],
  [0xc2, 0x41],
  [0xe0, 0x80, 0x80],
  [0xed, 0xa0, 0x80],
  [0xf0, 0x80, 0x80, 0x80],
  [0xf4, 0x90, 0x80, 0x80]
])("invalid UTF-8 spanning decode chunks is rejected: %j", async (...tail) => {
  const bytes = require("node:buffer").Buffer.concat([
    require("node:buffer").Buffer.alloc(49151, 0x61),
    require("node:buffer").Buffer.from(tail)
  ]);
  mockImportBytes(bytes);
  const checked = expect(readLibraryFile("song")).rejects.toThrow(
    "FileEncodingError"
  );
  await jest.advanceTimersByTimeAsync(50);
  await checked;
  expect(FileSystem.unlink).toHaveBeenCalledWith("file:///large.txt");
  expect(
    jest.mocked(FileSystem.readFile).mock.calls.map((call) => call[1])
  ).toEqual(["base64"]);
});

test("cancellation interrupts CPU validation before the next file chunk", async () => {
  mockImportBytes(
    require("node:buffer").Buffer.from("a".repeat(200000), "utf8")
  );
  const controller = new AbortController();
  const reading = readLibraryFile("song", controller.signal).catch(
    (error) => error
  );
  for (let index = 0; index < 30; index++) await Promise.resolve();
  expect(jest.getTimerCount()).toBe(2);
  controller.abort();
  expect(await reading).toMatchObject({ code: "cancelled" });
  expect(
    jest.mocked(FileSystem.readFile).mock.calls.map((call) => call[1])
  ).toEqual(["base64"]);
  expect(FileSystem.unlink).toHaveBeenCalledWith("file:///large.txt");
  expect(jest.getTimerCount()).toBe(0);
});

test("large startup preference loads yield without publishing a partial library", async () => {
  usePreferences.getState().updateSong(999, { tempo: 123 });
  await flushPreferences();
  const before = usePreferences.getState().songs;
  const rows = Array.from({ length: 64 }, (_, index) => ({
    key: `song:${index + 1}:0`,
    value: JSON.stringify({ tempo: 92, capo: index % 12 })
  }));
  jest
    .mocked(getAllItems)
    .mockImplementation(async (query) =>
      query.parameters?.[0] === "song:%" ? rows : []
    );
  const changed = jest.fn();
  const unsubscribe = usePreferences.subscribe(changed);
  let done = false;
  const reading = loadPreferences().then(() => {
    done = true;
  });
  try {
    for (let index = 0; index < 20; index++) await Promise.resolve();
    expect(done).toBe(false);
    expect(usePreferences.getState().songs).toBe(before);
    expect(changed).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(50);
    await reading;
    expect(Object.keys(usePreferences.getState().songs)).toHaveLength(64);
    expect(usePreferences.getState().songs[64]).toMatchObject({
      tempo: 92,
      capo: 3
    });
    expect(changed).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
  }
});

test("export normalizes stable preferences once and captures edits made while yielding", async () => {
  const songs = Array.from({ length: 32 }, (_, index) => ({
    id: index + 1,
    title: `Song ${index + 1} 🎵 Привіт`,
    content: "[Am]Words 世界",
    band_name: "Artist",
    youtube_music: "",
    youtobe_lesson: ""
  }));
  for (const song of songs)
    usePreferences
      .getState()
      .updateSong(song.id, { backupId: `song:${song.id}` });
  await flushPreferences();
  jest.mocked(db.transaction).mockClear();
  jest.mocked(getAllItems).mockResolvedValue(songs);
  jest.mocked(FileSystem.writeFile).mockResolvedValue(undefined);
  jest.mocked(FileSystem.stat).mockResolvedValue({
    size: 1000
  } as Awaited<ReturnType<typeof FileSystem.stat>>);
  jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
  jest.mocked(saveDocuments).mockResolvedValue([
    {
      uri: "content://backup/library.json",
      name: "library.json",
      error: null
    }
  ]);
  const normalize = jest.spyOn(
    require("../src/components/preferences"),
    "normalizeSongPreferences"
  );
  try {
    const exporting = exportLibrary();
    for (let index = 0; index < 20; index++) await Promise.resolve();
    expect(FileSystem.writeFile).not.toHaveBeenCalled();
    usePreferences.getState().updateSong(1, { tempo: 137 });
    await jest.advanceTimersByTimeAsync(50);
    await exporting;
    expect(normalize).toHaveBeenCalledTimes(33);
    const text = jest.mocked(FileSystem.writeFile).mock.calls[0][1];
    const exported = parseLibraryBackup(text);
    expect(exported).toHaveLength(32);
    expect(exported[0].preferences).toMatchObject({
      tempo: 137,
      backupId: "song:1"
    });
    expect(exported.map((song) => song.title)).toEqual(
      songs.map((song) => song.title)
    );
    expect(usePreferences.getState().songs[1].tempo).toBe(137);
    expect(db.transaction).not.toHaveBeenCalled();
  } finally {
    normalize.mockRestore();
  }
});

function largeBackup(version = 2) {
  return {
    format: "freetune-library",
    version,
    songs: Array.from({ length: 64 }, (_, index) => ({
      title: `Song ${index} Привіт 🎵`,
      content: "[Am]Words 世界",
      band_name: "Artist",
      youtube_music: "",
      youtobe_lesson: "",
      preferences: { tablature, cover, capo: index % 12 }
    }))
  };
}

test.each([1, 2])(
  "cooperative backup validation preserves all version %s songs",
  async (version) => {
    const source = largeBackup(version);
    if (version === 1) source.songs[0].title = "Legacy ".repeat(200);
    const text = JSON.stringify(source);
    const expected = parseLibraryBackup(text);
    let completed = false;
    const reading = parseLibraryBackupAsync(text).then((songs) => {
      completed = true;
      return songs;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    await jest.advanceTimersByTimeAsync(100);
    await expect(reading).resolves.toEqual(expected);
    expect(jest.getTimerCount()).toBe(0);
  }
);

test("backup cancellation stops normalization before the remaining songs", async () => {
  const normalize = jest.spyOn(
    require("../src/components/preferences"),
    "normalizeSongPreferences"
  );
  const controller = new AbortController();
  const reading = parseLibraryBackupAsync(
    JSON.stringify(largeBackup()),
    controller.signal
  ).catch((error) => error);
  try {
    await jest.advanceTimersByTimeAsync(0);
    const count = normalize.mock.calls.length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(64);
    controller.abort();
    expect(await reading).toMatchObject({ code: "cancelled" });
    expect(normalize).toHaveBeenCalledTimes(count);
    expect(jest.getTimerCount()).toBe(0);
    expect(db.transaction).not.toHaveBeenCalled();
  } finally {
    normalize.mockRestore();
  }
});

test("an invalid late backup song rejects the whole result after yielding", async () => {
  const source = largeBackup();
  source.songs[63].content = "";
  const reading = expect(
    parseLibraryBackupAsync(JSON.stringify(source))
  ).rejects.toThrow("BackupInvalid");
  await jest.advanceTimersByTimeAsync(100);
  await reading;
  expect(db.transaction).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test("export serializes each song without a second whole-library JSON pass", async () => {
  const songs = largeBackup().songs.map((song, index) => ({
    ...song,
    id: index + 1
  }));
  for (const song of songs)
    usePreferences.getState().updateSong(song.id, {
      ...song.preferences,
      backupId: `song:${song.id}`
    });
  await flushPreferences();
  jest.mocked(getAllItems).mockResolvedValue(songs);
  jest.mocked(FileSystem.writeFile).mockResolvedValue(undefined);
  jest.mocked(FileSystem.stat).mockResolvedValue({
    size: 1000
  } as Awaited<ReturnType<typeof FileSystem.stat>>);
  jest.mocked(FileSystem.unlink).mockResolvedValue(undefined);
  jest
    .mocked(saveDocuments)
    .mockResolvedValue([
      { uri: "content://backup.json", name: "backup.json", error: null }
    ]);
  const stringify = jest.spyOn(JSON, "stringify");
  try {
    const exporting = exportLibrary();
    await jest.advanceTimersByTimeAsync(100);
    await exporting;
    expect(
      stringify.mock.calls.some(
        ([value]) => Array.isArray(value?.songs) && value.songs.length > 1
      )
    ).toBe(false);
    const text = jest.mocked(FileSystem.writeFile).mock.calls[0][1];
    const restored = parseLibraryBackup(text);
    expect(restored.map((song) => song.title)).toEqual(
      songs.map((song) => song.title)
    );
    expect(restored.every((song) => song.preferences.cover === cover)).toBe(
      true
    );
    expect(restored[63].preferences.tablature).toMatchObject(tablature);
    expect(text).toBe(JSON.stringify(JSON.parse(text)));
  } finally {
    stringify.mockRestore();
  }
});
