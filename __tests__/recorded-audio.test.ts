import {
  acousticBank,
  acousticEngine,
  recordedChordFrets
} from "../src/components/acoustic-player";
import { normalizeSongPreferences } from "../src/components/preferences";
import { rhythms } from "../src/screens/song/rhythms";

const tuning = [40, 45, 50, 55, 59, 64];
const notesFor = (chord: string) =>
  recordedChordFrets[chord].flatMap((fret, string) =>
    fret === null
      ? []
      : [{ string, frequency: 440 * 2 ** ((tuning[string] + fret - 69) / 12) }]
  );

test("fingering preparation decodes only the first downstroke for matching voicings", () => {
  const notes = notesFor("Am");
  const bank = acousticBank(notes, [notes], true);
  expect(bank.recordings[0].down).toHaveLength(1);
  expect(bank.recordings[0].up).toHaveLength(0);
});

test.each(Object.keys(recordedChordFrets))(
  "%s has three distinct genuine strokes in both directions",
  (chord) => {
    const notes = notesFor(chord),
      bank = acousticBank(notes);
    expect(bank.recordings).toHaveLength(1);
    for (const direction of ["down", "up"] as const) {
      const samples = bank.recordings[0][direction];
      expect(samples).toHaveLength(3);
      expect(new Set(samples.map((sample) => sample.audio)).size).toBe(3);
      expect(samples.every((sample) => sample.level > 0)).toBe(true);
    }
    const other = notes.map((note) => ({
      ...note,
      frequency: note.frequency * 2
    }));
    expect(acousticBank(other).recordings).toHaveLength(0);
  }
);

test("recorded strokes rotate, keep original speed and schedule without new decodes", async () => {
  const sources: any[] = [];
  let decoded = 0;
  const parameter = () => ({
    value: 0,
    setValueAtTime: jest.fn(),
    linearRampToValueAtTime: jest.fn(),
    exponentialRampToValueAtTime: jest.fn(),
    cancelAndHoldAtTime: jest.fn()
  });
  const connection = () => ({ connect() {}, disconnect() {} });
  const audio = {
    currentTime: 0,
    destination: {},
    decodeAudioData: async () => ({ duration: 8.4, id: decoded++ }),
    createGain: () => ({ ...connection(), gain: parameter() }),
    createConvolver: () => ({ ...connection(), buffer: null }),
    createDynamicsCompressor: () => ({
      ...connection(),
      ...Object.fromEntries(
        ["threshold", "knee", "ratio", "attack", "release"].map((key) => [
          key,
          parameter()
        ])
      )
    }),
    createBufferSource: () => {
      const source = {
        ...connection(),
        playbackRate: { value: 1 },
        buffer: null,
        start: jest.fn(),
        stop: jest.fn()
      };
      sources.push(source);
      return source;
    }
  };
  const create = new Function("atob", `return (${acousticEngine})`)(
    (value: string) =>
      require("node:buffer").Buffer.from(value, "base64").toString("binary")
  );
  const engine = create(audio),
    notes = notesFor("Am"),
    bank = acousticBank(notes);
  await engine.loadBank({ ...bank, samples: [] });
  expect(decoded).toBe(7);
  for (let i = 0; i < 4; i++)
    engine.stroke(notes, "D", i, 0, false, "D-------");
  engine.stroke(notes, "U", 4, 0, false, "U-------");
  expect(sources[0].buffer).not.toBe(sources[1].buffer);
  expect(sources[3].buffer).toBe(sources[0].buffer);
  expect(sources[4].buffer).not.toBe(sources[0].buffer);
  expect(sources.every((source) => source.playbackRate.value === 1)).toBe(true);
  expect(sources.map((source) => source.start.mock.calls[0][0])).toEqual([
    0, 1, 2, 3, 4
  ]);
  expect(decoded).toBe(7);
  expect(sources.every((source) => !source.stop.mock.calls.length)).toBe(true);
  engine.stroke(notes, "X", 5, 0, true, "X-------");
  expect(sources.at(-1).start).toHaveBeenCalledWith(5);
  expect(sources.at(-1).stop).toHaveBeenCalledWith(5.14);
  expect(sources[0].stop).toHaveBeenCalledWith(5.22);
});

test("rhythm timing survives preference normalization and legacy songs use eighth notes", () => {
  expect(normalizeSongPreferences({}).strumDivision).toBe(2);
  expect(rhythms[0].id).toBe("six");
  for (const rhythm of rhythms) {
    const saved = normalizeSongPreferences({
      strum: rhythm.pattern,
      strumMeter: rhythm.meter,
      strumDivision: rhythm.division,
      strumPreset: rhythm.id
    });
    expect(saved.strum).toBe(rhythm.pattern);
    expect(saved.strumDivision).toBe(rhythm.division);
    expect(rhythm.pattern.length % (rhythm.meter * rhythm.division)).toBe(0);
  }
  expect(
    rhythms.find((rhythm) => rhythm.id === "nine")!.pattern.replace(/-/g, "")
  ).toHaveLength(9);
});
