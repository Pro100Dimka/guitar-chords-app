import React from "react";
import Renderer, { act } from "react-test-renderer";
import {
  TablatureTransport,
  useTablature
} from "../src/screens/play/use-tablature";
import { performanceAudio } from "../src/components/performance-audio";
import { warmGuitar } from "../src/components/guitar-audio";
import { defaultTabPractice } from "../src/components/tablature-practice";
import {
  emptyTablature,
  normalizeTablature,
  tablatureLength,
  TAB_MAX_BARS,
  TAB_MAX_NOTES,
  Tablature
} from "../src/components/tablature";

jest.mock("../src/components/guitar-audio", () => ({
  warmGuitar: jest.fn().mockResolvedValue(undefined)
}));
jest.mock("../src/components/performance-audio", () => ({
  performanceAudio: {
    guitarString: jest.fn(),
    stopGuitarString: jest.fn(),
    metronomeBeat: jest.fn(),
    stopMetronomeBeats: jest.fn()
  }
}));

const score = (notes: Tablature["notes"]): Tablature =>
  normalizeTablature({ ...emptyTablature(), notes })!;
const timerClock = () =>
  (globalThis as typeof globalThis & { performance: { now: () => number } })
    .performance;
let transport: TablatureTransport;
let onNotes: jest.Mock;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(warmGuitar).mockResolvedValue(undefined);
  onNotes = jest.fn();
  transport = new TablatureTransport(onNotes);
  transport.setActive(true);
});
afterEach(() => {
  transport.setActive(false);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test("recording starts on the first touch and keeps string, fret and musical time", () => {
  transport.startRecording();
  jest.advanceTimersByTime(2000);
  transport.capture([
    { string: 0, fret: 3 },
    { string: 5, fret: 7 }
  ]);
  jest.advanceTimersByTime(750);
  transport.capture([{ string: 2, fret: 4 }]);
  transport.stopRecording();
  expect(transport.getSnapshot()).toMatchObject({ status: "idle", tick: 0 });
  expect(transport.getSnapshot().tab.notes).toEqual([
    { string: 0, fret: 3, tick: 0, duration: 24 },
    { string: 5, fret: 7, tick: 0, duration: 24 },
    { string: 2, fret: 4, tick: 24, duration: 24 }
  ]);
  expect(jest.getTimerCount()).toBe(0);
  expect(performanceAudio.guitarString).not.toHaveBeenCalled();
});

test("same-tick string changes replace the note and invalid input starts no timer", () => {
  transport.startRecording();
  transport.capture([
    { string: 6, fret: 0 },
    { string: 0, fret: NaN }
  ]);
  expect(jest.getTimerCount()).toBe(0);
  transport.capture([
    { string: 0, fret: 2 },
    { string: 5, fret: 0 }
  ]);
  transport.capture([{ string: 0, fret: 4 }]);
  expect(transport.getSnapshot().tab.notes).toEqual([
    { string: 0, fret: 4, tick: 0, duration: 24 },
    { string: 5, fret: 0, tick: 0, duration: 24 }
  ]);
});

test("recording limits keep the completed take and stop timers", () => {
  transport.startRecording();
  for (let group = 0; group < Math.ceil(TAB_MAX_NOTES / 6); group++) {
    transport.capture(
      Array.from({ length: 6 }, (_, string) => ({ string, fret: 2 }))
    );
    jest.advanceTimersByTime(40);
  }
  expect(transport.getSnapshot()).toMatchObject({
    status: "idle",
    error: "TabRecordingLimit"
  });
  expect(transport.getSnapshot().tab.notes.length).toBe(2046);
  expect(jest.getTimerCount()).toBe(0);
});

test("duration limit is enforced even when no further strings are touched", () => {
  let clock = 0;
  jest
    .spyOn(
      (globalThis as typeof globalThis & { performance: { now: () => number } })
        .performance,
      "now"
    )
    .mockImplementation(() => clock);
  transport.startRecording();
  transport.capture([{ string: 3, fret: 0 }]);
  clock = TAB_MAX_BARS * 4 * 750;
  jest.advanceTimersByTime(50);
  expect(transport.getSnapshot()).toMatchObject({
    status: "idle",
    error: "TabRecordingLimit"
  });
  expect(transport.getSnapshot().tab.notes).toHaveLength(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("playback uses the recorded string sample and emits simultaneous notes together", async () => {
  transport.setTab(
    score([
      { string: 0, fret: 3, tick: 0 },
      { string: 5, fret: 7, tick: 0 },
      { string: 2, fret: 4, tick: 24 }
    ])
  );
  await transport.play();
  expect(warmGuitar).toHaveBeenCalledWith(
    [43],
    440,
    expect.any(AbortSignal),
    0
  );
  expect(performanceAudio.guitarString).toHaveBeenCalledWith(
    "440:43:string0",
    0
  );
  expect(performanceAudio.guitarString).toHaveBeenCalledWith(
    "440:71:string5",
    5
  );
  expect(onNotes.mock.calls[0][0]).toHaveLength(2);
  await jest.advanceTimersByTimeAsync(750);
  expect(performanceAudio.guitarString).toHaveBeenLastCalledWith(
    "440:54:string2",
    2
  );
});

test("pause and resume preserve the cursor without repeating expired notes", async () => {
  transport.setTab(
    score([
      { string: 0, fret: 0, tick: 0, duration: 6 },
      { string: 1, fret: 2, tick: 12, duration: 6 },
      { string: 2, fret: 2, tick: 24 }
    ])
  );
  await transport.play();
  await jest.advanceTimersByTimeAsync(625);
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(2);
  transport.pause();
  await jest.advanceTimersByTimeAsync(2000);
  expect(jest.getTimerCount()).toBe(0);
  await transport.play();
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(125);
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(3);
});

test("slower playback and a selected repeating bar exclude surrounding notes", async () => {
  transport.setTab(
    score([
      { string: 0, fret: 0, tick: 0 },
      { string: 1, fret: 2, tick: 96 },
      { string: 2, fret: 3, tick: 120 },
      { string: 3, fret: 4, tick: 192 }
    ])
  );
  transport.setRange({ start: 96, end: 192 });
  transport.setSpeed(0.5);
  transport.setLoop(true);
  await transport.play();
  expect(jest.mocked(performanceAudio.guitarString).mock.calls).toEqual([
    ["440:47:string1", 1]
  ]);
  await jest.advanceTimersByTimeAsync(1490);
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(4510);
  expect(jest.mocked(performanceAudio.guitarString).mock.calls).toEqual([
    ["440:47:string1", 1],
    ["440:53:string2", 2],
    ["440:47:string1", 1]
  ]);
});

test("preparation is cancelled on blur and cannot start audio after resolving", async () => {
  let finish!: () => void;
  jest.mocked(warmGuitar).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  transport.setTab(score([{ string: 5, fret: 2, tick: 0 }]));
  const pending = transport.play();
  expect(transport.getSnapshot().status).toBe("preparing");
  const signal = jest.mocked(warmGuitar).mock.calls[0][2];
  transport.setActive(false);
  expect(signal.aborted).toBe(true);
  finish();
  await pending;
  expect(transport.getSnapshot().status).toBe("idle");
  expect(performanceAudio.guitarString).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test("changing a score cancels old preparation and retains the replacement", async () => {
  let finish!: () => void;
  jest.mocked(warmGuitar).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  transport.setTab(score([{ string: 5, fret: 2, tick: 0 }]));
  const old = transport.play();
  const replacement = score([{ string: 0, fret: 3, tick: 0 }]);
  transport.setTab(replacement);
  await transport.play();
  finish();
  await old;
  expect(transport.getSnapshot().tab).toEqual(replacement);
  expect(jest.mocked(performanceAudio.guitarString).mock.calls).toEqual([
    ["440:43:string0", 0]
  ]);
});

test("a stalled frame skips obsolete notes instead of playing a catch-up burst", async () => {
  let clock = 0;
  jest
    .spyOn(
      (globalThis as typeof globalThis & { performance: { now: () => number } })
        .performance,
      "now"
    )
    .mockImplementation(() => clock);
  transport.setTab(
    score(
      Array.from({ length: 10 }, (_, index) => ({
        string: 0,
        fret: index,
        tick: index * 6
      }))
    )
  );
  await transport.play();
  clock = 1500;
  await jest.advanceTimersByTimeAsync(25);
  expect(jest.mocked(performanceAudio.guitarString).mock.calls).toEqual([
    ["440:40:string0", 0],
    ["440:48:string0", 0]
  ]);
});

test("warmup is bounded for scores containing more samples than native caches", async () => {
  transport.setTab(
    score(
      Array.from({ length: 50 }, (_, index) => ({
        string: index % 6,
        fret: Math.floor(index / 6),
        tick: index * 24
      }))
    )
  );
  await transport.play();
  await Promise.resolve();
  expect(jest.mocked(warmGuitar).mock.calls.length).toBeLessThanOrEqual(13);
  expect(jest.mocked(warmGuitar).mock.calls.length).toBeGreaterThan(1);
  expect(transport.getSnapshot().status).toBe("playing");
});

test("notes just before the end of a fast bar are emitted before transport stops", async () => {
  transport.setTab({
    ...score([
      { string: 0, fret: 0, tick: 0 },
      { string: 5, fret: 7, tick: 95, duration: 1 }
    ]),
    tempo: 200
  });
  transport.setSpeed(2);
  await transport.play();
  await jest.advanceTimersByTimeAsync(600);
  expect(jest.mocked(performanceAudio.guitarString).mock.calls).toEqual([
    ["440:40:string0", 0],
    ["440:71:string5", 5]
  ]);
  expect(transport.getSnapshot().status).toBe("idle");
  expect(jest.getTimerCount()).toBe(0);
});

test("long looping scores rewarm evicted samples without exceeding native capacity", async () => {
  const cached = new Set<string>();
  jest
    .mocked(warmGuitar)
    .mockImplementation(async (notes, _reference, _signal, string) => {
      const key = `440:${notes[0]}:string${string}`;
      cached.delete(key);
      cached.add(key);
      if (cached.size > 32) cached.delete(cached.values().next().value!);
    });
  jest.mocked(performanceAudio.guitarString).mockImplementation((key) => {
    if (!cached.has(key)) throw new Error("sample evicted");
  });
  transport.setTab(
    score(
      Array.from({ length: 50 }, (_, index) => ({
        string: index % 6,
        fret: Math.floor(index / 6),
        tick: index * 12
      }))
    )
  );
  transport.setLoop(true);
  await transport.play();
  await jest.advanceTimersByTimeAsync(
    tablatureLength(transport.getSnapshot().tab) * 31.25 * 2
  );
  expect(transport.getSnapshot()).toMatchObject({
    status: "playing",
    error: null
  });
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(101);
  expect(cached.size).toBeLessThanOrEqual(32);
  jest.mocked(performanceAudio.guitarString).mockReset();
});

test("preparation failures remain recoverable and leave no running timer", async () => {
  transport.setTab(score([{ string: 5, fret: 2, tick: 0 }]));
  jest.mocked(warmGuitar).mockRejectedValueOnce(new Error("audio"));
  await transport.play();
  expect(transport.getSnapshot()).toMatchObject({
    status: "idle",
    error: "TabPlaybackFailed"
  });
  expect(jest.getTimerCount()).toBe(0);
  await transport.play();
  expect(transport.getSnapshot().status).toBe("playing");
});

test("hook stops transport when unfocused or unmounted and keeps the recorded draft", async () => {
  let hook!: ReturnType<typeof useTablature>;
  function Host({ active }: { active: boolean }) {
    hook = useTablature(active, onNotes);
    return null;
  }
  let screen!: Renderer.ReactTestRenderer;
  await act(async () => {
    screen = Renderer.create(<Host active />);
  });
  await act(async () => {
    hook.startRecording();
    hook.capture([{ string: 0, fret: 3 }]);
  });
  await act(async () => {
    screen.update(<Host active={false} />);
  });
  expect(hook.status).toBe("idle");
  expect(hook.tab.notes).toHaveLength(1);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(100);
  });
  const afterBlur = jest.mocked(performanceAudio.guitarString).mock.calls
    .length;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1000);
  });
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(afterBlur);
  await act(async () => {
    screen.update(<Host active />);
    await hook.play();
  });
  await act(async () => {
    await hook.play();
  });
  expect(hook.status).toBe("playing");
  await act(async () => {
    screen.unmount();
    await jest.advanceTimersByTimeAsync(100);
  });
  expect(jest.getTimerCount()).toBe(0);
  expect(performanceAudio.stopGuitarString).toHaveBeenCalled();
});

test("edited notes release independently at their musical duration and speed", async () => {
  transport.replaceTab(
    score([
      { string: 0, fret: 0, tick: 0, duration: 12 },
      { string: 5, fret: 7, tick: 0, duration: 24 }
    ])
  );
  transport.setSpeed(0.5);
  await transport.play();
  jest.mocked(performanceAudio.stopGuitarString).mockClear();
  await jest.advanceTimersByTimeAsync(749);
  expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(jest.mocked(performanceAudio.stopGuitarString).mock.calls).toEqual([
    [0]
  ]);
  await jest.advanceTimersByTimeAsync(749);
  expect(performanceAudio.stopGuitarString).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(jest.mocked(performanceAudio.stopGuitarString).mock.calls).toEqual([
    [0],
    [5]
  ]);
});

test("an old note release cannot cut off a newer attack on the same string", async () => {
  transport.replaceTab(
    score([
      { string: 0, fret: 0, tick: 0, duration: 24 },
      { string: 0, fret: 3, tick: 12, duration: 48 }
    ])
  );
  await transport.play();
  jest.mocked(performanceAudio.stopGuitarString).mockClear();
  await jest.advanceTimersByTimeAsync(750);
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(2);
  expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1125);
  expect(jest.mocked(performanceAudio.stopGuitarString).mock.calls).toEqual([
    [0]
  ]);
});

test("pause, document replacement and blur cancel outstanding note releases", async () => {
  transport.replaceTab(score([{ string: 0, fret: 0, tick: 0, duration: 96 }]));
  await transport.play();
  transport.pause();
  jest.mocked(performanceAudio.stopGuitarString).mockClear();
  await jest.advanceTimersByTimeAsync(4000);
  expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  transport.rewind();
  await transport.play();
  transport.replaceTab(score([{ string: 5, fret: 7, tick: 0, duration: 12 }]));
  jest.mocked(performanceAudio.stopGuitarString).mockClear();
  await jest.advanceTimersByTimeAsync(4000);
  expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
  await transport.play();
  transport.setActive(false);
  jest.mocked(performanceAudio.stopGuitarString).mockClear();
  await jest.advanceTimersByTimeAsync(4000);
  expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test("an explicit rest and empty ending bars remain silent while time advances", async () => {
  transport.replaceTab({
    ...emptyTablature(80, 6, 8),
    barCount: 2,
    rests: [{ tick: 0, duration: 72 }]
  });
  await transport.play();
  expect(warmGuitar).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(3000);
  expect(transport.getSnapshot()).toMatchObject({
    status: "playing",
    tick: 96
  });
  expect(performanceAudio.guitarString).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1500);
  expect(transport.getSnapshot()).toMatchObject({ status: "idle", tick: 144 });
  expect(jest.getTimerCount()).toBe(0);
});

test("selected loops stop a crossing note at the range end and restart cleanly", async () => {
  transport.replaceTab(score([{ string: 0, fret: 0, tick: 0, duration: 144 }]));
  transport.setRange({ start: 0, end: 96 });
  transport.setLoop(true);
  await transport.play();
  await jest.advanceTimersByTimeAsync(3000);
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(2);
  jest.mocked(performanceAudio.stopGuitarString).mockClear();
  await jest.advanceTimersByTimeAsync(1500);
  expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
});

test("undo and redo preserve exact notes, rests, durations and bar edits", () => {
  const initial = score([{ string: 0, fret: 0, tick: 0, duration: 12 }]);
  transport.replaceTab(initial);
  const edited = {
    ...initial,
    barCount: 3,
    rests: [{ tick: 24, duration: 12 }]
  };
  expect(transport.setTab(edited)).toBe(true);
  expect(transport.getSnapshot()).toMatchObject({
    canUndo: true,
    canRedo: false
  });
  transport.undo();
  expect(transport.getSnapshot().tab).toEqual(initial);
  expect(transport.getSnapshot()).toMatchObject({
    canUndo: false,
    canRedo: true
  });
  transport.redo();
  expect(transport.getSnapshot().tab).toEqual(edited);
  transport.undo();
  transport.setTab({ ...initial, tempo: 90 });
  expect(transport.getSnapshot().canRedo).toBe(false);
  transport.redo();
  expect(transport.getSnapshot().tab.tempo).toBe(90);
});

test("unchanged and rejected documents create no extra undo entries", () => {
  const initial = score([{ string: 0, fret: 0, tick: 0, duration: 12 }]);
  transport.replaceTab(initial);
  expect(transport.setTab(initial)).toBe(true);
  expect(
    transport.setTab({ ...initial, rests: [{ tick: 0, duration: 24 }] })
  ).toBe(false);
  expect(transport.getSnapshot().tab).toEqual(initial);
  expect(transport.getSnapshot().canUndo).toBe(false);
  transport.setTab({ ...initial, tempo: 90 });
  transport.replaceTab(initial);
  expect(transport.getSnapshot()).toMatchObject({
    canUndo: false,
    canRedo: false,
    error: null
  });
});

test("a complete replacement recording is one undo operation and preserves its meter", () => {
  const original = {
    ...emptyTablature(80, 6, 8),
    notes: [{ string: 5, fret: 12, tick: 0, duration: 48 }],
    rests: [{ tick: 48, duration: 12 }]
  };
  transport.replaceTab(original);
  transport.startRecording();
  transport.capture([{ string: 0, fret: 0 }]);
  jest.advanceTimersByTime(250);
  transport.capture([{ string: 0, fret: 3 }]);
  jest.advanceTimersByTime(2250);
  transport.stopRecording();
  const recorded = transport.getSnapshot().tab;
  expect(recorded).toMatchObject({
    beatUnit: 8,
    beatsPerBar: 6,
    tempo: 80,
    barCount: 2,
    rests: []
  });
  expect(recorded.notes).toEqual([
    { string: 0, fret: 0, tick: 0, duration: 8 },
    { string: 0, fret: 3, tick: 8, duration: 24 }
  ]);
  transport.undo();
  expect(transport.getSnapshot().tab).toEqual(original);
  expect(transport.getSnapshot().canUndo).toBe(false);
  transport.redo();
  expect(transport.getSnapshot().tab).toEqual(recorded);
});

test("undo cancels audio and the bounded history retains the latest fifty edits", async () => {
  const initial = score([{ string: 0, fret: 0, tick: 0, duration: 24 }]);
  transport.replaceTab(initial);
  for (let edit = 1; edit <= 60; edit++)
    transport.setTab({ ...initial, tempo: 80 + edit });
  await transport.play();
  transport.undo();
  expect(transport.getSnapshot()).toMatchObject({
    status: "idle",
    canRedo: true
  });
  expect(jest.getTimerCount()).toBe(0);
  for (let edit = 0; edit < 60; edit++) transport.undo();
  expect(transport.getSnapshot().tab.tempo).toBe(90);
  expect(transport.getSnapshot().canUndo).toBe(false);
});

test("live speed changes preserve sustained voices and rebase their remaining release", async () => {
  transport.replaceTab(
    score([
      { string: 0, fret: 0, tick: 0, duration: 96 },
      { string: 5, fret: 7, tick: 48, duration: 24 }
    ])
  );
  await transport.play();
  await jest.advanceTimersByTimeAsync(375);
  jest.mocked(performanceAudio.stopGuitarString).mockClear();
  transport.setSpeed(0.5);
  expect(transport.getSnapshot()).toMatchObject({
    status: "playing",
    tick: 12,
    speed: 0.5
  });
  expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(2250);
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(2);
  expect(transport.getSnapshot().tick).toBe(48);
  transport.setSpeed(1);
  expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(749);
  expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(jest.mocked(performanceAudio.stopGuitarString).mock.calls).toEqual([
    [5]
  ]);
  await jest.advanceTimersByTimeAsync(749);
  expect(performanceAudio.stopGuitarString).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(transport.getSnapshot().status).toBe("idle");
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(2);
});

test("resume rearticulates only the latest still-sustaining note for its remaining time", async () => {
  transport.replaceTab(
    score([
      { string: 0, fret: 0, tick: 0, duration: 96 },
      { string: 0, fret: 3, tick: 12, duration: 6 },
      { string: 5, fret: 7, tick: 0, duration: 48 }
    ])
  );
  await transport.play();
  await jest.advanceTimersByTimeAsync(750);
  transport.pause();
  await jest.advanceTimersByTimeAsync(2000);
  jest.mocked(performanceAudio.guitarString).mockClear();
  await transport.play();
  expect(jest.mocked(performanceAudio.guitarString).mock.calls).toEqual([
    ["440:71:string5", 5]
  ]);
  jest.mocked(performanceAudio.stopGuitarString).mockClear();
  await jest.advanceTimersByTimeAsync(749);
  expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(jest.mocked(performanceAudio.stopGuitarString).mock.calls).toEqual([
    [5]
  ]);
});

test("resume inside an explicit rest does not resurrect an earlier clipped sustain", async () => {
  transport.replaceTab({
    ...emptyTablature(),
    notes: [
      { string: 0, fret: 0, tick: 0, duration: 96 },
      { string: 0, fret: 3, tick: 12, duration: 12 }
    ],
    rests: [{ tick: 24, duration: 24 }]
  });
  await transport.play();
  await jest.advanceTimersByTimeAsync(1000);
  transport.pause();
  jest.mocked(performanceAudio.guitarString).mockClear();
  await transport.play();
  expect(performanceAudio.guitarString).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(500);
  expect(performanceAudio.guitarString).not.toHaveBeenCalled();
});

test("a range and its loop restore a note attacked before the range starts", async () => {
  transport.replaceTab(score([{ string: 0, fret: 3, tick: 72, duration: 96 }]));
  transport.setRange({ start: 96, end: 192 });
  transport.setLoop(true);
  await transport.play();
  expect(warmGuitar).toHaveBeenCalledWith(
    [43],
    440,
    expect.any(AbortSignal),
    0
  );
  expect(jest.mocked(performanceAudio.guitarString).mock.calls).toEqual([
    ["440:43:string0", 0]
  ]);
  jest.mocked(performanceAudio.stopGuitarString).mockClear();
  await jest.advanceTimersByTimeAsync(2249);
  expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(jest.mocked(performanceAudio.stopGuitarString).mock.calls).toEqual([
    [0]
  ]);
  await jest.advanceTimersByTimeAsync(750);
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(2);
  jest.mocked(performanceAudio.stopGuitarString).mockClear();
  await jest.advanceTimersByTimeAsync(2249);
  expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(jest.mocked(performanceAudio.stopGuitarString).mock.calls).toEqual([
    [0]
  ]);
});

test("count-in starts only after preparation and starts playback on the following downbeat", async () => {
  let ready!: () => void;
  jest
    .mocked(warmGuitar)
    .mockImplementationOnce(
      () => new Promise<void>((resolve) => (ready = resolve))
    );
  transport.replaceTab(score([{ string: 0, fret: 3, tick: 0 }]));
  transport.setPractice({ ...defaultTabPractice(), countInBars: 1 });
  const preparing = transport.play();
  await jest.advanceTimersByTimeAsync(1000);
  expect(transport.getSnapshot().status).toBe("preparing");
  expect(performanceAudio.metronomeBeat).not.toHaveBeenCalled();
  ready();
  await preparing;
  expect(transport.getSnapshot()).toMatchObject({
    status: "countingIn",
    tick: 0,
    countIn: { bar: 1, beat: 1, bars: 1, target: "play" }
  });
  expect(performanceAudio.metronomeBeat).toHaveBeenCalledWith(2, 0.7);
  await jest.advanceTimersByTimeAsync(2999);
  expect(performanceAudio.guitarString).not.toHaveBeenCalled();
  expect(transport.getSnapshot().countIn?.beat).toBe(4);
  await jest.advanceTimersByTimeAsync(1);
  expect(transport.getSnapshot()).toMatchObject({
    status: "playing",
    tick: 0,
    countIn: null
  });
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(1);
  expect(performanceAudio.metronomeBeat).toHaveBeenCalledTimes(4);
});

test("two-bar count-in follows eighth-note beats and the 6/8 secondary accent", async () => {
  transport.replaceTab({
    ...emptyTablature(80, 6, 8),
    notes: [{ string: 0, fret: 0, tick: 0, duration: 72 }]
  });
  transport.setPractice({
    ...defaultTabPractice(),
    metronome: true,
    volume: 0.4,
    countInBars: 2
  });
  await transport.play();
  await jest.advanceTimersByTimeAsync(2250);
  expect(transport.getSnapshot().countIn).toEqual({
    bar: 2,
    beat: 1,
    bars: 2,
    target: "play"
  });
  await jest.advanceTimersByTimeAsync(2250);
  expect(transport.getSnapshot().status).toBe("playing");
  expect(jest.mocked(performanceAudio.metronomeBeat).mock.calls).toEqual(
    [2, 0, 0, 1, 0, 0, 2, 0, 0, 1, 0, 0, 2].map((accent) => [accent, 0.4])
  );
  await jest.advanceTimersByTimeAsync(1125);
  expect(performanceAudio.metronomeBeat).toHaveBeenLastCalledWith(1, 0.4);
  expect(transport.getSnapshot().tick).toBe(36);
});

test.each(["pause", "blur", "replace", "settings"] as const)(
  "%s cancels count-in with no late notes or clicks",
  async (cancel) => {
    transport.replaceTab(score([{ string: 0, fret: 3, tick: 0 }]));
    transport.setPractice({ ...defaultTabPractice(), countInBars: 2 });
    await transport.play();
    await jest.advanceTimersByTimeAsync(750);
    if (cancel === "pause") transport.pause();
    if (cancel === "blur") transport.setActive(false);
    if (cancel === "replace") transport.replaceTab(emptyTablature());
    if (cancel === "settings")
      transport.setPractice({ ...defaultTabPractice(), countInBars: 1 });
    const clicks = jest.mocked(performanceAudio.metronomeBeat).mock.calls
      .length;
    await jest.advanceTimersByTimeAsync(10000);
    expect(transport.getSnapshot()).toMatchObject({
      status: "idle",
      countIn: null
    });
    expect(performanceAudio.guitarString).not.toHaveBeenCalled();
    expect(performanceAudio.metronomeBeat).toHaveBeenCalledTimes(clicks);
    expect(performanceAudio.stopMetronomeBeats).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  }
);

test("cancelled recording count-in retains the exact original document and history", async () => {
  const original = score([{ string: 5, fret: 7, tick: 24, duration: 48 }]);
  transport.replaceTab(original);
  const edited = { ...original, tempo: 90 };
  transport.setTab(edited);
  transport.setPractice({ ...defaultTabPractice(), countInBars: 1 });
  transport.startRecording();
  transport.capture([{ string: 0, fret: 3 }]);
  expect(transport.getSnapshot()).toMatchObject({
    status: "countingIn",
    countIn: { target: "record" },
    tab: edited,
    canUndo: true,
    canRedo: false
  });
  await jest.advanceTimersByTimeAsync(1000);
  transport.stopRecording();
  expect(transport.getSnapshot().tab).toEqual(edited);
  expect(jest.getTimerCount()).toBe(0);
  transport.undo();
  expect(transport.getSnapshot().tab).toEqual(original);
  expect(transport.getSnapshot().canUndo).toBe(false);
});

test("counted recording includes leading silence at score tempo and remains one undo operation", async () => {
  const original = score([{ string: 5, fret: 7, tick: 0, duration: 24 }]);
  transport.replaceTab(original);
  transport.setSpeed(2);
  transport.setPractice({
    ...defaultTabPractice(),
    countInBars: 1,
    trainer: {
      enabled: true,
      startBpm: 160,
      targetBpm: 200,
      stepBpm: 10,
      repeats: 1
    }
  });
  transport.startRecording();
  expect(transport.getSnapshot().practiceBpm).toBe(80);
  await jest.advanceTimersByTimeAsync(2999);
  expect(transport.getSnapshot().tab).toEqual(original);
  await jest.advanceTimersByTimeAsync(1);
  expect(transport.getSnapshot()).toMatchObject({
    status: "recording",
    practiceBpm: 80,
    tick: 0
  });
  await jest.advanceTimersByTimeAsync(750);
  transport.capture([{ string: 0, fret: 3 }]);
  transport.stopRecording();
  expect(transport.getSnapshot().tab.notes).toEqual([
    { string: 0, fret: 3, tick: 24, duration: 24 }
  ]);
  expect(transport.getSnapshot().practiceBpm).toBe(160);
  transport.undo();
  expect(transport.getSnapshot().tab).toEqual(original);
  expect(transport.getSnapshot().canUndo).toBe(false);
});

test("recording with only metronome enabled starts a clock before the first touch", async () => {
  transport.setSpeed(0.25);
  transport.setPractice({ ...defaultTabPractice(), metronome: true });
  transport.startRecording();
  expect(performanceAudio.metronomeBeat).toHaveBeenCalledWith(2, 0.7);
  await jest.advanceTimersByTimeAsync(1500);
  expect(transport.getSnapshot()).toMatchObject({ tick: 48, practiceBpm: 80 });
  transport.capture([{ string: 2, fret: 5 }]);
  expect(transport.getSnapshot().tab.notes[0].tick).toBe(48);
  expect(jest.mocked(performanceAudio.metronomeBeat).mock.calls).toEqual([
    [2, 0.7],
    [0, 0.7],
    [0, 0.7]
  ]);
  transport.stopRecording();
  expect(jest.getTimerCount()).toBe(0);
});

test("metronome skips stale beats rather than emitting a stalled-frame burst", async () => {
  let time = 0;
  jest.spyOn(timerClock(), "now").mockImplementation(() => time);
  transport.replaceTab({
    ...emptyTablature(),
    barCount: 4,
    rests: [{ tick: 0, duration: 24 }]
  });
  transport.setPractice({ ...defaultTabPractice(), metronome: true });
  await transport.play();
  time = 2250;
  await jest.advanceTimersByTimeAsync(25);
  expect(performanceAudio.metronomeBeat).toHaveBeenCalledTimes(2);
  time = 4900;
  await jest.advanceTimersByTimeAsync(25);
  expect(performanceAudio.metronomeBeat).toHaveBeenCalledTimes(2);
  time = 5250;
  await jest.advanceTimersByTimeAsync(25);
  expect(performanceAudio.metronomeBeat).toHaveBeenCalledTimes(3);
});

test("trainer accelerates only after the requested complete loops and caps at target", async () => {
  transport.replaceTab({
    ...emptyTablature(80, 1),
    notes: [{ string: 0, fret: 0, tick: 0, duration: 12 }]
  });
  transport.setPractice({
    ...defaultTabPractice(),
    metronome: true,
    trainer: {
      enabled: true,
      startBpm: 60,
      targetBpm: 70,
      stepBpm: 7,
      repeats: 2
    }
  });
  expect(transport.getSnapshot()).toMatchObject({
    loop: true,
    practiceBpm: 60,
    completedLoops: 0
  });
  await transport.play();
  await jest.advanceTimersByTimeAsync(1999);
  expect(transport.getSnapshot()).toMatchObject({
    completedLoops: 1,
    practiceBpm: 60
  });
  await jest.advanceTimersByTimeAsync(1);
  expect(transport.getSnapshot()).toMatchObject({
    completedLoops: 2,
    practiceBpm: 67
  });
  await jest.advanceTimersByTimeAsync(1800);
  expect(transport.getSnapshot()).toMatchObject({
    completedLoops: 4,
    practiceBpm: 70
  });
  await jest.advanceTimersByTimeAsync(2600);
  expect(transport.getSnapshot()).toMatchObject({
    completedLoops: 7,
    practiceBpm: 70
  });
  expect(transport.getSnapshot().tab.tempo).toBe(80);
  expect(transport.getSnapshot().canUndo).toBe(false);
  expect(performanceAudio.metronomeBeat).toHaveBeenCalledTimes(8);
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(8);
});

test("pause and counted resume retain trainer progress and sustained musical position", async () => {
  transport.replaceTab(score([{ string: 0, fret: 3, tick: 0, duration: 96 }]));
  transport.setPractice({
    ...defaultTabPractice(),
    countInBars: 1,
    trainer: {
      enabled: true,
      startBpm: 60,
      targetBpm: 120,
      stepBpm: 20,
      repeats: 1
    }
  });
  await transport.play();
  await jest.advanceTimersByTimeAsync(8000);
  expect(transport.getSnapshot()).toMatchObject({
    completedLoops: 1,
    practiceBpm: 80,
    tick: 0
  });
  await jest.advanceTimersByTimeAsync(750);
  transport.pause();
  expect(transport.getSnapshot()).toMatchObject({
    completedLoops: 1,
    practiceBpm: 80,
    tick: 24
  });
  await jest.advanceTimersByTimeAsync(5000);
  await transport.play();
  expect(transport.getSnapshot()).toMatchObject({
    status: "countingIn",
    tick: 24
  });
  await jest.advanceTimersByTimeAsync(3000);
  expect(transport.getSnapshot()).toMatchObject({
    status: "playing",
    completedLoops: 1,
    practiceBpm: 80,
    tick: 24
  });
  await jest.advanceTimersByTimeAsync(2250);
  expect(transport.getSnapshot()).toMatchObject({
    completedLoops: 2,
    practiceBpm: 100,
    tick: 0
  });
});

test("inter-loop count-in uses the next trainer tempo and keeps note release gates stopped", async () => {
  transport.replaceTab({
    ...emptyTablature(80, 1),
    notes: [{ string: 0, fret: 3, tick: 0, duration: 24 }]
  });
  transport.setPractice({
    ...defaultTabPractice(),
    countInBars: 1,
    countInBetweenLoops: true,
    trainer: {
      enabled: true,
      startBpm: 60,
      targetBpm: 80,
      stepBpm: 20,
      repeats: 1
    }
  });
  await transport.play();
  await jest.advanceTimersByTimeAsync(1000);
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1000);
  expect(transport.getSnapshot()).toMatchObject({
    status: "countingIn",
    completedLoops: 1,
    practiceBpm: 80
  });
  await jest.advanceTimersByTimeAsync(749);
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(2);
  expect(transport.getSnapshot().status).toBe("playing");
  transport.pause();
  expect(jest.getTimerCount()).toBe(0);
});

test("trainer seek, range and rewind reset cycles while manual speed and loop-off disable training", async () => {
  transport.replaceTab(score([{ string: 0, fret: 0, tick: 0, duration: 192 }]));
  const practice = {
    ...defaultTabPractice(),
    trainer: {
      enabled: true,
      startBpm: 60,
      targetBpm: 80,
      stepBpm: 20,
      repeats: 1
    }
  };
  transport.setPractice(practice);
  transport.setRange({ start: 0, end: 96 });
  await transport.play();
  await jest.advanceTimersByTimeAsync(4000);
  expect(transport.getSnapshot().practiceBpm).toBe(80);
  transport.seek(48);
  expect(transport.getSnapshot()).toMatchObject({
    status: "idle",
    tick: 48,
    completedLoops: 0,
    practiceBpm: 60
  });
  await transport.play();
  await jest.advanceTimersByTimeAsync(2000);
  expect(transport.getSnapshot().completedLoops).toBe(0);
  await jest.advanceTimersByTimeAsync(4000);
  expect(transport.getSnapshot().completedLoops).toBe(1);
  transport.setRange({ start: 96, end: 192 });
  expect(transport.getSnapshot()).toMatchObject({
    tick: 96,
    completedLoops: 0,
    practiceBpm: 60
  });
  transport.seek(0);
  expect(transport.getSnapshot().tick).toBe(96);
  transport.seek(150);
  transport.rewind();
  expect(transport.getSnapshot().tick).toBe(96);
  transport.setSpeed(1);
  expect(transport.getSnapshot()).toMatchObject({
    practiceBpm: 80,
    practice: { trainer: { enabled: false } }
  });
  transport.setPractice(practice);
  transport.setLoop(false);
  expect(transport.getSnapshot()).toMatchObject({
    loop: false,
    practiceBpm: 80,
    practice: { trainer: { enabled: false } }
  });
});

test("pausing after an unprocessed loop boundary resumes clicks at the wrapped beat", async () => {
  let time = 0;
  jest.spyOn(timerClock(), "now").mockImplementation(() => time);
  transport.replaceTab(score([{ string: 0, fret: 3, tick: 0 }]));
  transport.setLoop(true);
  transport.setPractice({ ...defaultTabPractice(), metronome: true });
  await transport.play();
  time = 2250;
  await jest.advanceTimersByTimeAsync(25);
  expect(performanceAudio.metronomeBeat).toHaveBeenCalledTimes(2);
  time = 3100;
  transport.pause();
  expect(transport.getSnapshot()).toMatchObject({ tick: 3, completedLoops: 0 });
  await transport.play();
  time = 3750;
  await jest.advanceTimersByTimeAsync(25);
  expect(performanceAudio.metronomeBeat).toHaveBeenCalledTimes(3);
  expect(transport.getSnapshot().tick).toBe(24);
  time = 6000;
  await jest.advanceTimersByTimeAsync(25);
  expect(transport.getSnapshot().completedLoops).toBe(0);
});

test("trainer boundary rebases both note releases and metronome beats to the new tempo", async () => {
  transport.replaceTab(score([{ string: 0, fret: 3, tick: 0, duration: 24 }]));
  transport.setPractice({
    ...defaultTabPractice(),
    metronome: true,
    trainer: {
      enabled: true,
      startBpm: 60,
      targetBpm: 80,
      stepBpm: 20,
      repeats: 1
    }
  });
  await transport.play();
  await jest.advanceTimersByTimeAsync(4000);
  expect(transport.getSnapshot()).toMatchObject({
    completedLoops: 1,
    practiceBpm: 80
  });
  jest.mocked(performanceAudio.stopGuitarString).mockClear();
  jest.mocked(performanceAudio.metronomeBeat).mockClear();
  await jest.advanceTimersByTimeAsync(749);
  expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
  expect(performanceAudio.metronomeBeat).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(jest.mocked(performanceAudio.stopGuitarString).mock.calls).toEqual([
    [0]
  ]);
  expect(jest.mocked(performanceAudio.metronomeBeat).mock.calls).toEqual([
    [0, 0.7]
  ]);
});

test("a fast looping boundary emits only the new beat after a stalled frame", async () => {
  let time = 0;
  jest.spyOn(timerClock(), "now").mockImplementation(() => time);
  transport.replaceTab({
    ...emptyTablature(200, 6, 8),
    rests: [{ tick: 0, duration: 72 }]
  });
  transport.setSpeed(2);
  transport.setLoop(true);
  transport.setPractice({ ...defaultTabPractice(), metronome: true });
  await transport.play();
  jest.mocked(performanceAudio.metronomeBeat).mockClear();
  time = 450;
  await jest.advanceTimersByTimeAsync(25);
  expect(jest.mocked(performanceAudio.metronomeBeat).mock.calls).toEqual([
    [2, 0.7]
  ]);
});

test("inter-loop count-in waits for the next sample window without resetting trainer progress", async () => {
  let ready!: () => void;
  jest
    .mocked(warmGuitar)
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(
      () => new Promise<void>((resolve) => (ready = resolve))
    );
  transport.replaceTab({
    ...emptyTablature(80, 1),
    notes: [{ string: 0, fret: 3, tick: 0, duration: 24 }]
  });
  transport.setPractice({
    ...defaultTabPractice(),
    countInBars: 1,
    countInBetweenLoops: true,
    trainer: {
      enabled: true,
      startBpm: 60,
      targetBpm: 80,
      stepBpm: 20,
      repeats: 1
    }
  });
  await transport.play();
  await jest.advanceTimersByTimeAsync(2000);
  expect(transport.getSnapshot()).toMatchObject({
    status: "preparing",
    completedLoops: 1,
    practiceBpm: 80
  });
  expect(performanceAudio.metronomeBeat).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1000);
  expect(performanceAudio.metronomeBeat).toHaveBeenCalledTimes(1);
  ready();
  await jest.advanceTimersByTimeAsync(0);
  expect(transport.getSnapshot()).toMatchObject({
    status: "countingIn",
    completedLoops: 1,
    practiceBpm: 80
  });
  await jest.advanceTimersByTimeAsync(749);
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(2);
});

test("live metronome, volume and count-in preferences preserve trainer progress and sounding notes", async () => {
  transport.replaceTab(score([{ string: 0, fret: 3, tick: 0, duration: 96 }]));
  const practice = {
    ...defaultTabPractice(),
    trainer: {
      enabled: true,
      startBpm: 60,
      targetBpm: 100,
      stepBpm: 20,
      repeats: 1
    }
  };
  transport.setPractice(practice);
  await transport.play();
  await jest.advanceTimersByTimeAsync(4250);
  expect(transport.getSnapshot()).toMatchObject({
    completedLoops: 1,
    practiceBpm: 80,
    tick: 8
  });
  jest.mocked(performanceAudio.stopGuitarString).mockClear();
  transport.setPractice({
    ...practice,
    metronome: true,
    volume: 0.3,
    countInBars: 1
  });
  expect(transport.getSnapshot()).toMatchObject({
    status: "playing",
    completedLoops: 1,
    practiceBpm: 80,
    tick: 8
  });
  expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(500);
  expect(performanceAudio.metronomeBeat).toHaveBeenLastCalledWith(0, 0.3);
  await jest.advanceTimersByTimeAsync(2250);
  expect(transport.getSnapshot()).toMatchObject({
    completedLoops: 2,
    practiceBpm: 100
  });
});
