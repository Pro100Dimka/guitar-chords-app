import { db } from "../src/components/database";
import { getAllItems } from "../src/components/database/crud";
import {
  audioBackupFootprint,
  listAudioSongs
} from "../src/components/database/audio-analysis";
import { FileSystem } from "react-native-file-access";
import { saveDocuments } from "@react-native-documents/picker";
import {
  exportLibrary,
  parseLibraryBackup
} from "../src/components/library-files";
import {
  flushPreferences,
  loadPreferences,
  usePreferences
} from "../src/components/preferences";

jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));
jest.mock("../src/components/database/crud", () => ({
  getAllItems: jest.fn()
}));
jest.mock("../src/components/database/audio-analysis", () => ({
  listAudioSongs: jest.fn(),
  audioBackupFootprint: jest.fn()
}));

const cover = "data:image/jpeg;base64,/9j/2Q==";
beforeEach(() => {
  jest.useFakeTimers();
  usePreferences.setState({ songs: {}, saveError: false });
  jest.mocked(listAudioSongs).mockResolvedValue([]);
  jest.mocked(audioBackupFootprint).mockResolvedValue(0);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.resetAllMocks();
});

test("song preferences and cover survive serialization and reload; failed commits remain visible", async () => {
  let saved = "";
  let fail = true;
  jest.mocked(db.transaction).mockImplementation((body, error, success) => {
    body({
      executeSql: (_sql, args) => {
        saved = String(args?.[1]);
      }
    });
    if (fail) error?.(Object.assign(new Error("disk full"), { code: 1 }));
    else success?.();
  });
  usePreferences.getState().updateSong(17, {
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
  jest.mocked(getAllItems).mockResolvedValue([{ value: saved }]);
  await loadPreferences();
  expect(usePreferences.getState().songs[17]).toMatchObject({
    cover,
    favorite: true,
    position: 125,
    shapes: { F: 3 },
    tempo: 92
  });
});

test("exported backup retains artist, lyrics, cover and chord shapes", async () => {
  usePreferences.getState().updateSong(17, { cover, shapes: { Am: 2 } });
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
    preferences: { cover, shapes: { Am: 2 } }
  });
  expect(FileSystem.unlink).toHaveBeenCalledTimes(1);
  expect(() => parseLibraryBackup('{"format":"broken"}')).toThrow(
    "BackupInvalid"
  );
});
