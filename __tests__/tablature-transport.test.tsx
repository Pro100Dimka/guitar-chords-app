import React from "react";
import Renderer, { act } from "react-test-renderer";
import {
  TablatureTransport,
  useTablature
} from "../src/screens/play/use-tablature";
import { performanceAudio } from "../src/components/performance-audio";
import { warmGuitar } from "../src/components/guitar-audio";
import {
  emptyTablature,
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
    stopGuitarString: jest.fn()
  }
}));

const score = (notes: Tablature["notes"]): Tablature => ({
  ...emptyTablature(),
  notes
});
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
    { string: 0, fret: 3, tick: 0 },
    { string: 5, fret: 7, tick: 0 },
    { string: 2, fret: 4, tick: 24 }
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
    { string: 0, fret: 4, tick: 0 },
    { string: 5, fret: 0, tick: 0 }
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

test("pause and resume preserve the cursor without repeating an already played note", async () => {
  transport.setTab(
    score([
      { string: 0, fret: 0, tick: 0 },
      { string: 1, fret: 2, tick: 12 },
      { string: 2, fret: 2, tick: 24 }
    ])
  );
  await transport.play();
  await jest.advanceTimersByTimeAsync(375);
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(2);
  transport.pause();
  await jest.advanceTimersByTimeAsync(2000);
  expect(jest.getTimerCount()).toBe(0);
  await transport.play();
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(375);
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
      { string: 5, fret: 7, tick: 95 }
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
