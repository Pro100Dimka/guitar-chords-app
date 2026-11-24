import React from "react";
import Renderer, { act } from "react-test-renderer";
import { AppState, AppStateStatus } from "react-native";
import { warmGuitar } from "../src/components/guitar-audio";
import {
  performanceAudio,
  PerformanceEvent
} from "../src/components/performance-audio";
import { TAB_TUNING, TabNote } from "../src/components/tablature";
import { useTablaturePreview } from "../src/screens/play/use-tablature-preview";

jest.mock("../src/components/guitar-audio", () => ({
  warmGuitar: jest.fn()
}));
jest.mock("../src/components/performance-audio", () => ({
  performanceAudio: {
    preparedFingeringSupported: true,
    prepareFingering: jest.fn(),
    guitarString: jest.fn(),
    stopGuitarString: jest.fn(),
    stopPlayback: jest.fn(),
    listen: jest.fn()
  }
}));

let screen: Renderer.ReactTestRenderer | undefined;
let preview: ReturnType<typeof useTablaturePreview>;
let onAppState: (state: AppStateStatus) => void;
let onAudio: (event: PerformanceEvent) => void;
const appRemove = jest.fn();
const audioRemove = jest.fn();
const note = (fret = 0, string = 0): TabNote => ({
  string,
  fret,
  tick: 0,
  duration: 24
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function Harness({ enabled = true }: { enabled?: boolean }) {
  preview = useTablaturePreview(enabled);
  return null;
}
async function render(enabled = true) {
  await act(async () => {
    screen = Renderer.create(<Harness enabled={enabled} />);
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  AppState.currentState = "active";
  performanceAudio.preparedFingeringSupported = true;
  jest.mocked(warmGuitar).mockResolvedValue(undefined);
  jest.mocked(performanceAudio.prepareFingering).mockResolvedValue(true);
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, listener) => {
    onAppState = listener;
    return { remove: appRemove };
  });
  jest.mocked(performanceAudio.listen).mockImplementation((listener) => {
    onAudio = listener;
    return { remove: audioRemove } as unknown as ReturnType<
      typeof performanceAudio.listen
    >;
  });
});
afterEach(async () => {
  if (screen) await act(async () => screen?.unmount());
  screen = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test("a prepared note sounds on the native cache response without timers or WAV preparation", async () => {
  jest.useFakeTimers();
  await render();
  const schedule = jest.spyOn(globalThis, "setTimeout");
  preview.preview(note(7, 5));
  await Promise.resolve();
  expect(performanceAudio.prepareFingering).toHaveBeenCalledWith(
    "440:71:string5",
    ""
  );
  expect(performanceAudio.guitarString).toHaveBeenCalledWith(
    "440:71:string5",
    5
  );
  expect(warmGuitar).not.toHaveBeenCalled();
  expect(schedule).not.toHaveBeenCalled();
  expect(performanceAudio.stopPlayback).not.toHaveBeenCalled();
});

test.each(TAB_TUNING.map((midi, string) => ({ midi, string })))(
  "string $string previews the same pitch and sample key as the transport",
  async ({ midi, string }) => {
    await render();
    await act(async () => preview.preview(note(24, string)));
    expect(performanceAudio.guitarString).toHaveBeenCalledWith(
      `440:${midi + 24}:string${string}`,
      string
    );
  }
);

test("a cold or evicted note waits for its physical-string sample before sounding", async () => {
  const ready = deferred<void>();
  jest.mocked(performanceAudio.prepareFingering).mockResolvedValue(false);
  jest.mocked(warmGuitar).mockReturnValue(ready.promise);
  await render();
  await act(async () => preview.preview(note(3, 1)));
  expect(warmGuitar).toHaveBeenCalledWith(
    [48],
    440,
    expect.any(AbortSignal),
    1
  );
  expect(performanceAudio.guitarString).not.toHaveBeenCalled();
  await act(async () => ready.resolve());
  expect(performanceAudio.guitarString).toHaveBeenCalledWith(
    "440:48:string1",
    1
  );
});

test("entering a second digit cancels the first cold attack and only sounds the final fret", async () => {
  const first = deferred<void>();
  const second = deferred<void>();
  jest.mocked(performanceAudio.prepareFingering).mockResolvedValue(false);
  jest
    .mocked(warmGuitar)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  await render();
  await act(async () => preview.preview(note(1)));
  const firstSignal = jest.mocked(warmGuitar).mock.calls[0][2];
  await act(async () => preview.preview(note(12)));
  const secondSignal = jest.mocked(warmGuitar).mock.calls[1][2];
  expect(firstSignal.aborted).toBe(true);
  expect(secondSignal.aborted).toBe(false);
  await act(async () => first.resolve());
  expect(performanceAudio.guitarString).not.toHaveBeenCalled();
  await act(async () => second.resolve());
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(1);
  expect(performanceAudio.guitarString).toHaveBeenCalledWith(
    "440:52:string0",
    0
  );
});

test("superseded native probes cannot queue a late cold preparation or attack", async () => {
  const first = deferred<boolean>();
  jest
    .mocked(performanceAudio.prepareFingering)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(true);
  await render();
  await act(async () => preview.preview(note(1)));
  await act(async () => preview.preview(note(12)));
  await act(async () => first.resolve(false));
  expect(warmGuitar).not.toHaveBeenCalled();
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(1);
  expect(performanceAudio.guitarString).toHaveBeenCalledWith(
    "440:52:string0",
    0
  );
});

test("repeating a prepared note retriggers immediately and changing strings releases only the previous preview", async () => {
  await render();
  await act(async () => preview.preview(note(3, 2)));
  await act(async () => preview.preview(note(3, 2)));
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(2);
  expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
  await act(async () => preview.preview(note(4, 4)));
  expect(performanceAudio.stopGuitarString).toHaveBeenCalledTimes(1);
  expect(performanceAudio.stopGuitarString).toHaveBeenCalledWith(2);
  expect(performanceAudio.guitarString).toHaveBeenLastCalledWith(
    "440:63:string4",
    4
  );
  expect(performanceAudio.stopPlayback).not.toHaveBeenCalled();
});

test("explicit cancellation before a transport handoff releases just its voice and aborts pending work", async () => {
  await render();
  await act(async () => preview.preview(note(3, 2)));
  const ready = deferred<void>();
  jest.mocked(performanceAudio.prepareFingering).mockResolvedValue(false);
  jest.mocked(warmGuitar).mockReturnValue(ready.promise);
  await act(async () => preview.preview(note(9, 4)));
  const signal = jest.mocked(warmGuitar).mock.calls[0][2];
  preview.cancelPreview();
  expect(signal.aborted).toBe(true);
  expect(performanceAudio.stopGuitarString).toHaveBeenCalledTimes(1);
  expect(performanceAudio.stopGuitarString).toHaveBeenCalledWith(2);
  preview.cancelPreview();
  expect(performanceAudio.stopGuitarString).toHaveBeenCalledTimes(1);
  await act(async () => ready.resolve());
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(1);
  expect(performanceAudio.stopPlayback).not.toHaveBeenCalled();
});

test.each(["disable", "background", "inactive", "interruption", "unmount"])(
  "%s revokes cold work without stopping a new audio owner's strings",
  async (reason) => {
    await render();
    await act(async () => preview.preview(note(3, 2)));
    const ready = deferred<void>();
    jest.mocked(performanceAudio.prepareFingering).mockResolvedValue(false);
    jest.mocked(warmGuitar).mockReturnValue(ready.promise);
    await act(async () => preview.preview(note(9, 4)));
    const signal = jest.mocked(warmGuitar).mock.calls[0][2];
    await act(async () => {
      if (reason === "disable") screen!.update(<Harness enabled={false} />);
      if (reason === "background" || reason === "inactive") onAppState(reason);
      if (reason === "interruption") onAudio({ state: "playbackInterrupted" });
      if (reason === "unmount") {
        screen!.unmount();
        screen = undefined;
      }
    });
    expect(signal.aborted).toBe(true);
    preview.cancelPreview();
    await act(async () => ready.resolve());
    expect(performanceAudio.guitarString).toHaveBeenCalledTimes(1);
    expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
    expect(performanceAudio.stopPlayback).not.toHaveBeenCalled();
  }
);

test("hidden and background panels ignore input, and returning never replays their cancelled notes", async () => {
  await render(false);
  await act(async () => preview.preview(note()));
  expect(performanceAudio.prepareFingering).not.toHaveBeenCalled();
  await act(async () => screen!.update(<Harness />));
  onAppState("background");
  await act(async () => preview.preview(note()));
  expect(performanceAudio.prepareFingering).not.toHaveBeenCalled();
  onAppState("active");
  expect(performanceAudio.guitarString).not.toHaveBeenCalled();
  await act(async () => preview.preview(note(5)));
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(1);
});

test("a callback retained before hide cannot preview after a later reopening", async () => {
  await render();
  const oldPreview = preview.preview;
  const oldCancel = preview.cancelPreview;
  await act(async () => screen!.update(<Harness enabled={false} />));
  await act(async () => screen!.update(<Harness />));
  await act(async () => oldPreview(note()));
  expect(performanceAudio.prepareFingering).not.toHaveBeenCalled();
  await act(async () => preview.preview(note()));
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(1);
  oldCancel();
  expect(performanceAudio.stopGuitarString).not.toHaveBeenCalled();
  preview.cancelPreview();
  expect(performanceAudio.stopGuitarString).toHaveBeenCalledTimes(1);
});

test.each(["probe", "warm"])(
  "a failed %s can be retried on the next tap",
  async (stage) => {
    if (stage === "probe")
      jest
        .mocked(performanceAudio.prepareFingering)
        .mockRejectedValueOnce(new Error("disposed"));
    else {
      jest
        .mocked(performanceAudio.prepareFingering)
        .mockResolvedValueOnce(false);
      jest.mocked(warmGuitar).mockRejectedValueOnce(new Error("decode failed"));
    }
    await render();
    await act(async () => preview.preview(note()));
    expect(performanceAudio.guitarString).not.toHaveBeenCalled();
    await act(async () => preview.preview(note()));
    expect(performanceAudio.guitarString).toHaveBeenCalledTimes(1);
  }
);

test("legacy native modules await warmGuitar and invalid note data never starts audio", async () => {
  performanceAudio.preparedFingeringSupported = false;
  await render();
  for (const invalid of [
    note(-1),
    note(25),
    note(0, -1),
    note(0, 6),
    note(NaN),
    { tick: 0, duration: 24 } as TabNote
  ])
    await act(async () => preview.preview(invalid));
  expect(warmGuitar).not.toHaveBeenCalled();
  await act(async () => preview.preview(note(3, 1)));
  expect(performanceAudio.prepareFingering).not.toHaveBeenCalled();
  expect(warmGuitar).toHaveBeenCalledWith(
    [48],
    440,
    expect.any(AbortSignal),
    1
  );
  expect(performanceAudio.guitarString).toHaveBeenCalledWith(
    "440:48:string1",
    1
  );
});

test("unmount removes both lifecycle listeners", async () => {
  await render();
  await act(async () => screen!.unmount());
  screen = undefined;
  expect(appRemove).toHaveBeenCalledTimes(1);
  expect(audioRemove).toHaveBeenCalledTimes(1);
});
