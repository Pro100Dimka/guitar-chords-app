import {
  sourceMetadata,
  sourceSong,
  sourceTempo
} from "../src/components/song-autofill/source-metadata";
import {
  matchedSongArrangement,
  providerContext
} from "../src/components/song-autofill/lyrics";
import { readGuitarPro } from "../src/components/song-autofill/guitar-pro";

test("Guitar Pro import follows actual attacks, preserves repeated strokes and aligns lyric cues", async () => {
  const {
    importer,
    exporter
  }: typeof import("@coderline/alphatab") = require("@coderline/alphatab");
  const score = importer.ScoreLoader
    .loadAlphaTex(String.raw`\title "Synthetic Song" \artist "Example Performer" \tempo 80 .
    \section "Verse" (0.6 2.5 2.4 0.3 0.2 0.1).4 (0.6 2.5 2.4 0.3 0.2 0.1).4 (3.6 2.5 0.4 0.3 0.2 3.1).2 |
    \section "Chorus" (3.5 2.4 0.3 1.2 0.1).2 (0.4 2.3 3.2 2.1).2 |`);
  const data = new exporter.Gp7Exporter().export(score);
  const input = {
    data,
    content:
      "[Verse]\n[Em]First original words [G]for this verse\n\n[Chorus]\n[C]Other original words [D]for this chorus",
    title: "Synthetic Song",
    artist: "Example Performer",
    source: {
      name: "GtpTabs.com",
      url: "https://gtptabs.com/tabs/1/example-performer/synthetic-song.html"
    },
    context: providerContext
  };
  const imported = await readGuitarPro(input);
  expect(imported?.tablature).toMatchObject({
    tempo: 80,
    barCount: 2,
    tuning: [40, 45, 50, 55, 59, 64],
    chords: [
      { name: "Em", tick: 0 },
      { name: "G", tick: 48 },
      { name: "C", tick: 96 },
      { name: "D", tick: 144 }
    ]
  });
  expect(
    imported?.tablature.notes
      .filter((note) => note.string === 0)
      .map((note) => note.tick)
  ).toEqual([0, 24, 48]);
  expect(imported?.content).toContain("First original");
  expect(
    await readGuitarPro({ ...input, artist: "Another Performer" })
  ).toBeUndefined();
});

test("a matched chorus uses timed strums while its verse retains the source picking", () => {
  const text = [
    "Intro",
    "E|---------0-",
    "B|-------0---",
    "G|-----0-----",
    "D|---2-------",
    "A|--2--------",
    "E|-0---------",
    "Verse",
    "[Em]Verse words",
    "Chorus",
    "[C]Dreams [D]aren't [G]empty",
    "[C]Conscience [D]seems [E]to be[Esus4][E][Esus4][E]",
    "[Bm]Hours [C9]lonely [D]vengeance [A5(9)]free"
  ].join("\n");
  const baseline = sourceSong(text, 120).tablature!;
  const matched = sourceSong(
    text,
    120,
    true,
    matchedSongArrangement("Behind Blue Eyes", "Limp Bizkit")
  ).tablature!;
  const chorus = matched.chords!.find((chord) => chord.name === "C")!.tick;
  expect(matched.notes.filter((note) => note.tick < chorus)).toEqual(
    baseline.notes.filter((note) => note.tick < chorus)
  );
  const firstChord = matched.notes.filter(
    (note) => note.tick >= chorus && note.tick < chorus + 96
  );
  expect([...new Set(firstChord.map((note) => note.tick - chorus))]).toEqual([
    0, 48, 84
  ]);
  expect(
    firstChord.every((note) => ["downBrush", "upBrush"].includes(note.pick!))
  ).toBe(true);
  expect(matchedSongArrangement("Behind Blue Eyes", "The Who")).toBeUndefined();
});

test.each(["Picking: B32123", "Tempo: 100-120"])(
  "keeps unresolved published instructions instead of silently deleting %s",
  (instruction) => {
    const content = `${instruction}\n[Am]Example words for a song`;
    expect(sourceSong(content).content).toBe(content);
  }
);

test("keeps labelled chord diagrams as chord changes rather than arpeggio attacks", () => {
  const imported = sourceSong(
    [
      "|-[D]0-----[A]0-",
      "|-3-----0-",
      "|-2-----2-",
      "|-0-----2-",
      "|-0-----0-",
      "|-0-----0-",
      "[Verse]",
      "[D]Example words [A]for this song"
    ].join("\n")
  );
  expect(imported.tablature?.chords?.map((chord) => chord.name)).toEqual([
    "D",
    "A",
    "D",
    "A"
  ]);
  expect([
    ...new Set(imported.tablature?.notes.map((note) => note.tick))
  ]).toEqual([0, 96, 192, 288]);
  expect(imported.content).not.toContain("|-");
  expect(imported.content).toContain("[D]Example words [A]for this song");
});

describe("explicit chart tempo", () => {
  it.each([
    ["Темп: 128 BPM", 128],
    ["Tempo = 92", 92],
    ["BPM: 108", 108],
    ["128 bpm", 128],
    ["♩ = 84", 84],
    ["Tempo: ♩ = 96", 96],
    ["Темп: 120 уд/мин", 120],
    ["Темп: 120 ударов в минуту", 120],
    ["Andamento: 118", 118],
    ["Tempo:\n123", 123],
    ["BPM\n123", 123],
    ["{tempo: 124}", 124],
    ["{meta: tempo 124}", 124],
    ["[Tempo: 124]", 124],
    ["ＢＰＭ：１２４", 124],
    ["Tempo: 120,5 BPM", 121],
    ["Tempo: 120.5 BPM", 121],
    ["BPM: 40", 40],
    ["BPM: 200", 200],
    ["Tempo: 96\nVerse:\n[Am]Synthetic lyric\nBPM: 96", 96]
  ])("imports the explicitly published value: %s", (text, expected) => {
    expect(sourceTempo(text)).toBe(expected);
  });

  it.each([
    "[Am]There are 120 reasons to sing",
    "Capo: 2\nFont size: 18\nScroll speed: 100",
    "Playback speed: 1.25x",
    "The tempo of the night is changing",
    "Tempo: 0",
    "Tempo: 39.9",
    "Tempo: 200.1",
    "Tempo: 240",
    "Tempo: -80",
    "Tempo: 80-120",
    "Tempo: 80 / 160",
    "Tempo: approximately 120",
    "Tempo: 120 seconds",
    "Tempo: ♪ = 120",
    "Tempo: ♩. = 120",
    "Tempo:",
    "Tempo:\nCapo: 2",
    "Tempo: 80\nBPM: 120",
    "Tempo: 80\nTempo: 0",
    "Tempo: 80\nTempo: 100-120",
    "Verse:\nTempo: 80\nChorus:\nTempo: 120"
  ])("leaves unknown, invalid or conflicting tempo unset: %s", (text) => {
    expect(sourceTempo(text)).toBeUndefined();
  });

  it("keeps tempo and accompaniment independently without altering content", () => {
    const text = "Темп: 92\nПеребор: восьмёрка\n[Am]Synthetic lyric";
    expect(sourceMetadata(text)).toEqual({
      tempo: 92,
      rhythm: {
        strum: "B3231323",
        strumMeter: 4,
        strumDivision: 2,
        strumPreset: "pick-eight",
        rhythmSections: {}
      }
    });
    expect(text).toBe("Темп: 92\nПеребор: восьмёрка\n[Am]Synthetic lyric");
    expect(sourceMetadata("Tempo: 80\nTempo: 120\nБой: шестёрка")).toEqual({
      rhythm: expect.objectContaining({ strumPreset: "six" })
    });
  });
});
