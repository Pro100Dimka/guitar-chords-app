import React from "react";
import Renderer, { act } from "react-test-renderer";
import { Alert, TextInput } from "react-native";
import { Action, Sheet } from "../src/screens/song/tools";
import { TablatureLibrary } from "../src/screens/play/tablature-library";
import {
  getTablatureSong,
  listTablatureSongs,
  saveTablature
} from "../src/components/tablature-library";
import type { Tablature } from "../src/components/tablature";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: String })
}));
jest.mock("../src/components/tablature-library", () => ({
  getTablatureSong: jest.fn(),
  listTablatureSongs: jest.fn(),
  saveTablature: jest.fn(),
  TAB_LIBRARY_PAGE_SIZE: 30
}));
jest.mock("../src/screens/song/tools", () => ({
  Sheet: ({ children, ...props }: any) =>
    require("react").createElement(
      require("react-native").View,
      props,
      children
    ),
  Action: ({ label, ...props }: any) =>
    require("react").createElement(require("react-native").Pressable, {
      ...props,
      accessibilityLabel: label
    })
}));

const tab: Tablature = {
  version: 2,
  tempo: 80,
  beatsPerBar: 4,
  beatUnit: 4,
  barCount: 1,
  rests: [],
  notes: [{ string: 2, fret: 7, tick: 24, duration: 24 }]
};
let screen: Renderer.ReactTestRenderer | undefined;
let callbacks: {
  onLoad: jest.Mock;
  onSaved: jest.Mock;
  onNew: jest.Mock;
  onClose: jest.Mock;
};
const action = (label: string) =>
  screen!.root
    .findAll((node) => typeof node.props.onPress === "function")
    .find((node) => node.props.accessibilityLabel === label)!;
const item = (title: string) =>
  screen!.root.findAll(
    (node) =>
      node.props.accessibilityLabel === title &&
      typeof node.props.onPress === "function"
  )[0];
const titleInput = () =>
  screen!.root
    .findAllByType(TextInput)
    .find((node) => node.props.accessibilityLabel === "TabSongTitle")!;

async function render(
  props: Partial<React.ComponentProps<typeof TablatureLibrary>> = {},
  strict = false
) {
  await act(async () => {
    const content = (
      <TablatureLibrary
        mode="save"
        tab={tab}
        song={null}
        {...callbacks}
        {...props}
      />
    );
    screen = Renderer.create(
      strict ? <React.StrictMode>{content}</React.StrictMode> : content
    );
  });
}
async function loadList() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(150);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  callbacks = {
    onLoad: jest.fn(),
    onSaved: jest.fn(),
    onNew: jest.fn(),
    onClose: jest.fn()
  };
  jest
    .mocked(listTablatureSongs)
    .mockResolvedValue([{ id: 7, title: "Saved riff" }]);
  jest
    .mocked(getTablatureSong)
    .mockResolvedValue({ id: 7, title: "Saved riff", tablature: tab });
  jest.mocked(saveTablature).mockResolvedValue(17);
});
afterEach(async () => {
  if (screen) await act(async () => screen?.unmount());
  screen = undefined;
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("a composed rest-only part can be saved from the library dialog", async () => {
  const silence = {
    ...tab,
    notes: [],
    rests: [{ tick: 0, duration: 24 }]
  };
  await render({ tab: silence });
  await act(async () => titleInput().props.onChangeText("Count a rest"));
  expect(action("TabSave").props.disabled).toBe(false);
  await act(async () => action("TabSave").props.onPress());
  expect(saveTablature).toHaveBeenCalledWith({
    id: undefined,
    title: "Count a rest",
    tablature: silence
  });
});

test.each([false, true])(
  "opens a saved tab from the library (StrictMode: %s)",
  async (strict) => {
    await render({ mode: "open" }, strict);
    await loadList();
    expect(listTablatureSongs).toHaveBeenCalledWith("", true, 0);
    await act(async () => item("Saved riff").props.onPress());
    expect(getTablatureSong).toHaveBeenCalledWith(7);
    expect(callbacks.onLoad).toHaveBeenCalledTimes(1);
    expect(callbacks.onLoad).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, title: "Saved riff" }),
      tab,
      undefined
    );
    expect(saveTablature).not.toHaveBeenCalled();
  }
);

test("failed save keeps the name and dialog available for retry", async () => {
  jest
    .mocked(saveTablature)
    .mockRejectedValueOnce(new Error("disk full"))
    .mockResolvedValueOnce(17);
  await render();
  await act(async () => titleInput().props.onChangeText(" My riff "));
  await act(async () => action("TabSave").props.onPress());
  expect(callbacks.onSaved).not.toHaveBeenCalled();
  expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(titleInput().props.value).toBe(" My riff ");
  expect(
    screen!.root.findAll(
      (node) =>
        node.props.accessibilityRole === "alert" &&
        node.props.children === "TabSaveFailed"
    ).length
  ).toBeGreaterThan(0);
  expect(action("TabSave").props.disabled).toBe(false);
  await act(async () => action("TabSave").props.onPress());
  expect(saveTablature).toHaveBeenCalledTimes(2);
  expect(callbacks.onSaved).toHaveBeenCalledWith(
    { id: 17, title: "My riff" },
    tab
  );
});

test("two rapid save taps share one operation and block close until it finishes", async () => {
  let finish!: (id: number) => void;
  jest.mocked(saveTablature).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await render({ song: { id: 7, title: "Saved riff" } });
  const press = action("TabSave").props.onPress;
  await act(async () => {
    press();
    press();
  });
  expect(saveTablature).toHaveBeenCalledTimes(1);
  expect(action("TabSaving").props.disabled).toBe(true);
  await act(async () => screen!.root.findByType(Sheet).props.onClose());
  expect(callbacks.onClose).not.toHaveBeenCalled();
  await act(async () => finish(7));
  expect(callbacks.onSaved).toHaveBeenCalledTimes(1);
});

test("cancelling replacement leaves the previously linked song selected", async () => {
  const original = { id: 17, title: "Original target" };
  jest.mocked(getTablatureSong).mockImplementation(async (id) => ({
    id,
    title: id === 17 ? original.title : "Saved riff",
    tablature: tab
  }));
  await render({ song: original });
  await act(async () => action("TabAttachSong").props.onPress());
  await loadList();
  expect(listTablatureSongs).toHaveBeenCalledWith("", false, 0);
  await act(async () => item("Saved riff").props.onPress());
  const confirmation = jest.mocked(Alert.alert).mock.calls.at(-1)!;
  expect(confirmation[1]).toBe("TabReplaceAttached");
  const cancel = confirmation[2]!.find((button) => button.style === "cancel")!;
  await act(async () => cancel.onPress?.());
  expect(saveTablature).not.toHaveBeenCalled();
  await act(async () => action("Back").props.onPress());
  expect(titleInput().props.value).toBe(original.title);
  await act(async () => action("TabSave").props.onPress());
  expect(saveTablature).toHaveBeenCalledWith({
    id: 17,
    title: original.title,
    tablature: tab
  });
});

test("a late save completion cannot reopen or update a closed editor", async () => {
  let finish!: (id: number) => void;
  jest.mocked(saveTablature).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await render({ song: { id: 7, title: "Riff" } });
  await act(async () => action("TabSave").props.onPress());
  await act(async () => screen!.unmount());
  screen = undefined;
  await act(async () => finish(7));
  expect(callbacks.onSaved).not.toHaveBeenCalled();
});

test.each([false, true])(
  "refreshes a stale Play song name before saving (StrictMode: %s)",
  async (strict) => {
    jest.mocked(saveTablature).mockResolvedValue(7);
    let finish!: (song: {
      id: number;
      title: string;
      tablature: Tablature;
    }) => void;
    jest.mocked(getTablatureSong).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    await render({ song: { id: 7, title: "Old Play title" } }, strict);
    expect(titleInput().props.editable).toBe(false);
    expect(action("TabLoading").props.disabled).toBe(true);
    expect(action("TabAttachSong").props.disabled).toBe(true);
    await act(async () => action("TabLoading").props.onPress());
    expect(saveTablature).not.toHaveBeenCalled();
    await act(async () =>
      finish({ id: 7, title: "Renamed in library", tablature: tab })
    );
    expect(titleInput().props.value).toBe("Renamed in library");
    expect(titleInput().props.editable).toBe(true);
    await act(async () => action("TabSave").props.onPress());
    expect(saveTablature).toHaveBeenCalledWith({
      id: 7,
      title: "Renamed in library",
      tablature: tab
    });
    expect(callbacks.onSaved).toHaveBeenCalledWith(
      { id: 7, title: "Renamed in library" },
      tab
    );
  }
);

test("a late retry refresh preserves the title explicitly entered after a read failure", async () => {
  let finish!: (song: {
    id: number;
    title: string;
    tablature: Tablature;
  }) => void;
  jest
    .mocked(getTablatureSong)
    .mockRejectedValueOnce(new Error("read failed"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
  await render({ song: { id: 7, title: "Old Play title" } });
  expect(action("TabSave").props.disabled).toBe(true);
  expect(titleInput().props.editable).toBe(true);
  await act(async () =>
    titleInput().props.onChangeText("My explicit new title")
  );
  await act(async () => action("Retry").props.onPress());
  expect(titleInput().props.editable).toBe(false);
  await act(async () =>
    finish({ id: 7, title: "Current database title", tablature: tab })
  );
  expect(titleInput().props.value).toBe("My explicit new title");
  await act(async () => action("TabSave").props.onPress());
  expect(saveTablature).toHaveBeenCalledWith({
    id: 7,
    title: "My explicit new title",
    tablature: tab
  });
});

test("a deleted linked song can only be saved as a new song until another target is selected", async () => {
  jest.mocked(getTablatureSong).mockResolvedValue(undefined);
  await render({ song: { id: 7, title: "Removed song" } });
  expect(action("TabSave").props.disabled).toBe(true);
  await act(async () => action("TabSave").props.onPress());
  expect(saveTablature).not.toHaveBeenCalled();
  await act(async () => action("TabSaveAsNew").props.onPress());
  expect(action("TabSave").props.disabled).toBe(false);
  await act(async () => action("TabSave").props.onPress());
  expect(saveTablature).toHaveBeenCalledWith({
    id: undefined,
    title: "Removed song",
    tablature: tab
  });
});

test("closing during title refresh ignores a late result", async () => {
  let finish!: (song: {
    id: number;
    title: string;
    tablature: Tablature;
  }) => void;
  jest.mocked(getTablatureSong).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await render({ song: { id: 7, title: "Old title" } });
  await act(async () => screen!.root.findByType(Sheet).props.onClose());
  expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  await act(async () => screen!.unmount());
  screen = undefined;
  await act(async () => finish({ id: 7, title: "Late title", tablature: tab }));
  expect(callbacks.onSaved).not.toHaveBeenCalled();
  expect(callbacks.onLoad).not.toHaveBeenCalled();
  expect(saveTablature).not.toHaveBeenCalled();
});

test("returning from target selection keeps a failed refresh retryable", async () => {
  jest.mocked(getTablatureSong).mockRejectedValue(new Error("read failed"));
  await render({ song: { id: 7, title: "Old title" } });
  await act(async () => action("TabAttachSong").props.onPress());
  await loadList();
  await act(async () => action("Back").props.onPress());
  expect(action("Retry").props.disabled).toBe(false);
  expect(action("TabSave").props.disabled).toBe(true);
  expect(titleInput().props.value).toBe("Old title");
});
