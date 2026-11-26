import {
  sourceMetadata,
  sourceSong,
  sourceTempo
} from "../src/components/song-autofill/source-metadata";

test.each(["Picking: B32123", "Tempo: 100-120"])(
  "keeps unresolved published instructions instead of silently deleting %s",
  (instruction) => {
    const content = `${instruction}\n[Am]Example words for a song`;
    expect(sourceSong(content).content).toBe(content);
  }
);

test("does not play chord diagrams with names embedded in the first tab row", () => {
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
  expect(imported.tablature).toBeUndefined();
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
