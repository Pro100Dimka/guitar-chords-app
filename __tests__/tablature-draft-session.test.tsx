import React, { useState } from "react";
import Renderer, { act } from "react-test-renderer";
import { AppState } from "react-native";
import { emptyTablature } from "../src/components/tablature";
import {
  readTablatureDraft,
  writeTablatureDraft,
  TablatureDraft
} from "../src/components/tablature-draft";
import { useTablatureDraft } from "../src/screens/play/use-tablature-draft";

jest.mock("../src/components/tablature-draft", () => ({
  readTablatureDraft: jest.fn(),
  writeTablatureDraft: jest.fn()
}));

const empty = (): TablatureDraft => ({
  version: 1,
  tab: emptyTablature(),
  savedTab: emptyTablature(),
  song: null
});
const riff = (): TablatureDraft => ({
  ...empty(),
  tab: {
    ...emptyTablature(100, 6, 8),
    barCount: 2,
    notes: [{ string: 0, fret: 3, tick: 0, duration: 18 }],
    rests: [{ tick: 18, duration: 6 }]
  },
  song: { id: 7, title: "My riff" }
});

let screen: Renderer.ReactTestRenderer | undefined;
let state: ReturnType<typeof useTablatureDraft>;
let edit: React.Dispatch<React.SetStateAction<TablatureDraft>>;
let document: TablatureDraft;
let onAppState: (state: string) => void;
const restored = jest.fn();
function Harness({ active = true }: { active?: boolean }) {
  const [draft, setDraft] = useState(empty);
  edit = setDraft;
  document = draft;
  state = useTablatureDraft(draft, active, (stored) => {
    restored(stored);
    setDraft(stored);
  });
  return null;
}
async function render(strict = false) {
  await act(async () => {
    screen = Renderer.create(
      strict ? (
        <React.StrictMode>
          <Harness />
        </React.StrictMode>
      ) : (
        <Harness />
      )
    );
  });
}
async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(readTablatureDraft).mockResolvedValue(null);
  jest.mocked(writeTablatureDraft).mockResolvedValue(undefined);
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, callback) => {
    onAppState = callback as (state: string) => void;
    return { remove: jest.fn() };
  });
});
afterEach(async () => {
  if (screen) await act(async () => screen?.unmount());
  screen = undefined;
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("restores the working document and saved baseline without overwriting disk", async () => {
  const draft = riff();
  jest.mocked(readTablatureDraft).mockResolvedValue(draft);
  await render();
  expect(document).toEqual(draft);
  expect(state).toMatchObject({ ready: true, status: "restored" });
  await advance(1000);
  expect(writeTablatureDraft).not.toHaveBeenCalled();
});

test("typing is debounced and saves the most recent complete document", async () => {
  await render();
  await act(async () => edit(riff()));
  await advance(300);
  await act(async () =>
    edit((draft) => ({ ...draft, tab: { ...draft.tab, tempo: 120 } }))
  );
  await advance(300);
  expect(writeTablatureDraft).not.toHaveBeenCalled();
  expect(state.status).toBe("saving");
  await advance(200);
  expect(writeTablatureDraft).toHaveBeenCalledTimes(1);
  expect(writeTablatureDraft).toHaveBeenCalledWith(document);
  expect(state.status).toBe("saved");
});

test.each(["background", "blur", "unmount"])(
  "%s flushes a recent edit before the debounce expires",
  async (reason) => {
    await render();
    await act(async () => edit(riff()));
    expect(writeTablatureDraft).not.toHaveBeenCalled();
    await act(async () => {
      if (reason === "background") onAppState("background");
      if (reason === "blur") screen!.update(<Harness active={false} />);
      if (reason === "unmount") {
        screen!.unmount();
        screen = undefined;
      }
    });
    expect(writeTablatureDraft).toHaveBeenCalledTimes(1);
    expect(writeTablatureDraft).toHaveBeenCalledWith(riff());
  }
);

test("continuous playing checkpoints within two seconds without waiting for silence", async () => {
  await render();
  for (let fret = 0; fret < 7; fret++) {
    await act(async () =>
      edit((draft) => ({
        ...draft,
        tab: {
          ...draft.tab,
          notes: [{ string: 0, tick: 0, duration: 24, fret }]
        }
      }))
    );
    await advance(300);
  }
  expect(writeTablatureDraft).toHaveBeenCalledTimes(1);
  expect(writeTablatureDraft).toHaveBeenLastCalledWith(document);
  expect(state.status).toBe("saved");
});

test("an undo during a slow write is saved even if it matches the previously saved document", async () => {
  await render();
  let finish!: () => void;
  jest.mocked(writeTablatureDraft).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => edit(riff()));
  await advance(500);
  await act(async () => edit(empty()));
  await advance(500);
  expect(
    jest.mocked(writeTablatureDraft).mock.calls.map(([value]) => value)
  ).toEqual([riff(), empty()]);
  await act(async () => finish());
  expect(document).toEqual(empty());
  expect(state.status).toBe("saved");
});

test("failed writes keep edits and offer retry without reloading old data", async () => {
  await render();
  jest.mocked(writeTablatureDraft).mockRejectedValueOnce(new Error("full"));
  await act(async () => edit(riff()));
  await advance(500);
  expect(state).toMatchObject({ ready: true, status: "writeError" });
  expect(document).toEqual(riff());
  await act(async () => state.retry());
  expect(state.status).toBe("saved");
  expect(readTablatureDraft).toHaveBeenCalledTimes(1);
  expect(writeTablatureDraft).toHaveBeenCalledTimes(2);
});

test("retry persists an undo after an earlier queued edit commits but the undo write fails", async () => {
  await render();
  let finishFirst!: () => void;
  let failSecond!: (reason: Error) => void;
  jest
    .mocked(writeTablatureDraft)
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          failSecond = reject;
        })
    );
  await act(async () => edit(riff()));
  await advance(500);
  await act(async () => edit(empty()));
  await advance(500);
  await act(async () => finishFirst());
  await act(async () => failSecond(new Error("disk full")));
  expect(state.status).toBe("writeError");
  await act(async () => state.retry());
  expect(writeTablatureDraft).toHaveBeenCalledTimes(3);
  expect(writeTablatureDraft).toHaveBeenLastCalledWith(empty());
  expect(state.status).toBe("saved");
});

test("undoing a failed edit back to the durable document clears the save error", async () => {
  await render();
  jest.mocked(writeTablatureDraft).mockRejectedValueOnce(new Error("full"));
  await act(async () => edit(riff()));
  await advance(500);
  expect(state.status).toBe("writeError");
  await act(async () => edit(empty()));
  expect(state.status).toBe("saved");
  await advance(500);
  expect(writeTablatureDraft).toHaveBeenCalledTimes(1);
});

test("failed reads block autosave and preserve the draft until retry succeeds", async () => {
  jest.mocked(readTablatureDraft).mockRejectedValueOnce(new Error("busy"));
  await render();
  expect(state).toMatchObject({ ready: false, status: "readError" });
  await advance(1000);
  expect(writeTablatureDraft).not.toHaveBeenCalled();
  jest.mocked(readTablatureDraft).mockResolvedValue(riff());
  await act(async () => state.retry());
  expect(document).toEqual(riff());
  expect(state).toMatchObject({ ready: true, status: "restored" });
});

test("an unreadable draft is removed only by an explicit successful reset", async () => {
  jest.mocked(readTablatureDraft).mockRejectedValue(new Error("invalid"));
  await render();
  jest.mocked(writeTablatureDraft).mockRejectedValueOnce(new Error("busy"));
  await act(async () => state.startNew());
  expect(state).toMatchObject({ ready: false, status: "readError" });
  await act(async () => state.startNew());
  expect(writeTablatureDraft).toHaveBeenLastCalledWith(null);
  expect(state).toMatchObject({ ready: true, status: "saved" });
});

test("late hydration cannot publish after unmount and StrictMode ignores its first abandoned read", async () => {
  let finish!: (draft: TablatureDraft) => void;
  jest.mocked(readTablatureDraft).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render(true);
  expect(state.ready).toBe(true);
  await act(async () => finish(riff()));
  expect(document).toEqual(empty());
  expect(restored).not.toHaveBeenCalled();
  await act(async () => {
    screen!.unmount();
    screen = undefined;
  });
  expect(writeTablatureDraft).not.toHaveBeenCalled();
});
