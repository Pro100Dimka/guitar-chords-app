import {
  SongAnalysis,
  validateSongAnalysis
} from "../src/components/song-analysis/types";
import { parseLibraryBackup } from "../src/components/library-files";

jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));

const example = (): SongAnalysis => ({
  version: 1,
  duration: 30,
  language: "uk",
  lyrics: [
    {
      start: 4.25,
      end: 12.8,
      text: "Тиха пісня",
      words: [
        { start: 4.25, end: 7, text: "Тиха", confidence: 0.9 },
        { start: 8, end: 12.8, text: "пісня", uncertain: true }
      ]
    }
  ],
  chords: [
    { start: 1.2, end: 7.35, label: "Am" },
    { start: 7.35, end: 16.9, label: "C" }
  ],
  warnings: [],
  model: { lyrics: "whisper", alignment: "dtw", chords: "chroma" }
});

test("validation preserves measured timing, intros, lyric gaps and sustained words exactly", () => {
  const source = example();
  expect(validateSongAnalysis(source)).toEqual(source);
});

test("a manually replaced line retains line timing without fabricated word times", () => {
  const source = example();
  source.lyrics[0].words = [];
  expect(validateSongAnalysis(source).lyrics[0]).toMatchObject({
    start: 4.25,
    end: 12.8,
    words: []
  });
});

test.each([
  (value: SongAnalysis) => {
    value.duration = NaN;
  },
  (value: SongAnalysis) => {
    value.chords[0].start = -1;
  },
  (value: SongAnalysis) => {
    value.chords[0].end = 31;
  },
  (value: SongAnalysis) => {
    value.lyrics[0].words[0].end = 15;
  },
  (value: SongAnalysis) => {
    value.lyrics[0].words[0].start = 0;
  },
  (value: SongAnalysis) => {
    value.lyrics[0].words[0].confidence = 2;
  },
  (value: SongAnalysis) => {
    value.chords.reverse();
  },
  (value: SongAnalysis) => {
    value.chords[0].end = value.chords[0].start;
  }
])(
  "rejects invalid timeline or confidence rather than silently rescaling it",
  (mutate) => {
    const source = example();
    mutate(source);
    expect(() => validateSongAnalysis(source)).toThrow("AnalysisInvalid");
  }
);

test("backup accepts v1 and preserves v2 edits while rejecting executable paths and mismatched durations", () => {
  const audio = {
    sha256: "a".repeat(64),
    originalName: "song.wav",
    mimeType: "audio/wav",
    bytes: 48000,
    duration: 30,
    analysis: example(),
    generatedAnalysis: example(),
    revision: 4,
    manuallyEdited: true,
    fileName: "/data/private/file.wav"
  };
  const backup = {
    format: "freetune-library",
    version: 2,
    audioIncluded: false,
    audioPolicy: "relink-original-by-sha256",
    songs: [
      {
        title: "Song",
        content: "",
        band_name: "",
        youtube_music: "",
        youtobe_lesson: "",
        preferences: {},
        audio
      }
    ]
  };
  const parsed = parseLibraryBackup(JSON.stringify(backup));
  expect(parsed[0].audio).toMatchObject({
    revision: 4,
    manuallyEdited: true,
    analysis: example()
  });
  expect(parsed[0].audio).not.toHaveProperty("fileName");
  audio.duration = 25;
  expect(() => parseLibraryBackup(JSON.stringify(backup))).toThrow(
    "BackupInvalid"
  );
  const legacy = {
    ...backup,
    version: 1,
    songs: [{ ...backup.songs[0], content: "Am text" }]
  };
  expect(parseLibraryBackup(JSON.stringify(legacy))[0]).not.toHaveProperty(
    "audio"
  );
});
