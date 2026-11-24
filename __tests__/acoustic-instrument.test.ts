import {
  AcousticInstrument,
  prepareAcousticInstrument,
  transferAcousticInstrument
} from "../src/components/acoustic-instrument";
import * as acoustic from "../src/components/acoustic-player";

const tuning = [40, 45, 50, 55, 59, 64];
const notesFor = (chord: string) =>
  acoustic.recordedChordFrets[chord].flatMap((fret, string) =>
    fret === null
      ? []
      : [
          {
            string,
            frequency: 440 * 2 ** ((tuning[string] + fret - 69) / 12)
          }
        ]
  );
const digest = (value: string) =>
  require("node:crypto").createHash("sha256").update(value).digest("hex");

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test.each([false, true])(
  "chunked instrument preserves all samples and recorded strokes, preview=%s",
  async (preview) => {
    const chords = [...Object.keys(acoustic.recordedChordFrets)].reverse();
    const frequencies = chords.map(notesFor);
    frequencies.push(frequencies[0], [{ string: 0, frequency: 70 }]);
    const spec: AcousticInstrument = {
      chords,
      frequencies,
      previewKeys: [],
      preview
    };
    const task = prepareAcousticInstrument(spec, new AbortController().signal);
    await jest.runAllTimersAsync();
    const chunks = (await task)!;
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.every((chunk) => chunk.length <= 64 * 1024)).toBe(true);
    const expected = JSON.stringify({
      chords,
      frequencies,
      previewKeys: [],
      bank: acoustic.acousticBank(frequencies.flat(), frequencies, preview)
    });
    expect(digest(chunks.join(""))).toBe(digest(expected));
  }
);

test("closing bank preparation cancels the next voicing", async () => {
  const bank = jest.spyOn(acoustic, "acousticBank");
  const controller = new AbortController();
  const task = prepareAcousticInstrument(
    {
      chords: ["Am", "C", "G"],
      frequencies: ["Am", "C", "G"].map(notesFor),
      previewKeys: [],
      preview: false
    },
    controller.signal
  );
  expect(bank).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(0);
  expect(bank).toHaveBeenCalledTimes(1);
  controller.abort();
  await expect(task).resolves.toBeUndefined();
  await jest.runAllTimersAsync();
  expect(bank).toHaveBeenCalledTimes(1);
});

test("chunk transfers preserve order and finish atomically", async () => {
  const input = ["first", "second", "third", "fourth", "fifth"];
  const received: string[] = [];
  let completed = false;
  const runtime = {
    beginInstrument: jest.fn(),
    appendInstrument: (token: number, chunk: string) => {
      expect(token).toBe(17);
      expect(completed).toBe(false);
      received.push(chunk);
    },
    finishInstrument: (token: number) => {
      expect(token).toBe(17);
      expect(received).toEqual(input);
      completed = true;
    }
  };
  const inject = (script: string) =>
    require("node:vm").runInNewContext(script, { window: runtime });
  const task = transferAcousticInstrument(
    input,
    17,
    inject,
    new AbortController().signal
  );
  expect(received).toEqual([]);
  await jest.runAllTimersAsync();
  await task;
  expect(completed).toBe(true);
});

test("canceling transfer drops remaining chunks and commit", async () => {
  const controller = new AbortController();
  const scripts: string[] = [];
  const task = transferAcousticInstrument(
    Array(20).fill("payload"),
    1,
    (script) => {
      scripts.push(script);
      if (script.startsWith("window.appendInstrument")) controller.abort();
    },
    controller.signal
  );
  await jest.runAllTimersAsync();
  await task;
  expect(
    scripts.filter((script) => script.includes("appendInstrument"))
  ).toHaveLength(1);
  expect(scripts.some((script) => script.includes("finishInstrument"))).toBe(
    false
  );
});
