import {
  acousticBank,
  acousticEngine,
  recordedChordFrets
} from "../src/components/acoustic-player";
import { normalizeSongPreferences } from "../src/components/preferences";
import { rhythms } from "../src/screens/song/rhythms";

const tuning = [40, 45, 50, 55, 59, 64];
test("bundled audio and artwork remain within the mobile resource budgets", () => {
  const { readdirSync, statSync } = require("node:fs");
  const { join } = require("node:path");
  const size = (path: string): number =>
    statSync(path).isDirectory()
      ? readdirSync(path).reduce(
          (total: number, name: string) => total + size(join(path, name)),
          0
        )
      : statSync(path).size;
  expect(
    size("assets/guitar-recordings") +
      size("assets/guitar-bank.json") +
      size("assets/guitar-samples.json")
  ).toBeLessThan(28_000_000);
  expect(size("assets/images")).toBeLessThan(8_000_000);
});
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

test.each([
  { chord: "D/A", frets: [10, 0, 0, 7, 7, 10], bass: 45 },
  { chord: "C/G", frets: [null, null, 10, 0, 8, 0], bass: 55 },
  { chord: "A", frets: [9, 0, 7, 9, 10, 0], bass: 45 }
])(
  "bass stroke uses lowest pitch for available $chord voicing",
  ({ chord, frets, bass }) => {
    expect(
      require("../src/screens/song/chords").chordShapes(chord)
    ).toContainEqual(frets);
    const sources: {
      buffer: { midi: number } | null;
      playbackRate: { value: number };
      start: () => void;
      stop: () => void;
      connect: () => void;
      disconnect: () => void;
    }[] = [];
    const parameter = () => ({
      value: 0,
      setValueAtTime() {},
      linearRampToValueAtTime() {},
      exponentialRampToValueAtTime() {},
      cancelAndHoldAtTime() {}
    });
    const connect = () => ({ connect() {}, disconnect() {} });
    const audio = {
      currentTime: 0,
      destination: {},
      createGain: () => ({ ...connect(), gain: parameter() }),
      createConvolver: () => ({ ...connect(), buffer: null }),
      createDynamicsCompressor: () => ({
        ...connect(),
        ...Object.fromEntries(
          ["threshold", "knee", "ratio", "attack", "release"].map((key) => [
            key,
            parameter()
          ])
        )
      }),
      createBufferSource: () => {
        const source = {
          ...connect(),
          buffer: null,
          playbackRate: { value: 1 },
          start() {},
          stop() {}
        };
        sources.push(source);
        return source;
      }
    };
    const buffers = tuning.map((midi, string) => ({
      midi,
      string,
      soft: { midi, duration: 2 },
      medium: { midi, duration: 2 }
    }));
    const engine = new Function(`return (${acousticEngine})`)()(audio, {
      buffers
    });
    const notes = frets.flatMap((fret, string) =>
      fret === null
        ? []
        : [
            {
              string,
              frequency: 440 * 2 ** ((tuning[string] + fret - 69) / 12)
            }
          ]
    );
    const order = notes.map((note) => note.string);
    engine.stroke(notes, "B", 0, 0, false, "B-D-B-D-");
    expect(sources).toHaveLength(1);
    expect(
      sources[0].buffer!.midi + 12 * Math.log2(sources[0].playbackRate.value)
    ).toBeCloseTo(bass, 6);
    engine.stroke(notes, "D", 1, 0, false, "D-------");
    expect(sources.slice(1).map((source) => source.buffer!.midi)).toEqual(
      order.map((string) => tuning[string])
    );
    const upStart = sources.length;
    engine.stroke(notes, "U", 2, 0, false, "U-------");
    expect(sources.slice(upStart).map((source) => source.buffer!.midi)).toEqual(
      [...order]
        .reverse()
        .slice(0, 3)
        .map((string) => tuning[string])
    );
    expect(notes.map((note) => note.string)).toEqual(order);
  }
);
