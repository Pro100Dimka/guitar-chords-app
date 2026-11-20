import React, { useState } from "react";
import Renderer, { act } from "react-test-renderer";
import { View } from "react-native";
import {
  TablatureBar,
  TablaturePanel
} from "../src/screens/play/tablature-panel";
import { Tablature, emptyTablature } from "../src/components/tablature";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, number>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
  })
}));
jest.mock("../src/screens/song/tools", () => {
  const React = require("react");
  const Native = require("react-native");
  return {
    Action: ({ label, accessibilityLabel, onPress, disabled, selected }: any) =>
      React.createElement(Native.Pressable, {
        accessibilityLabel: accessibilityLabel ?? label,
        accessibilityState: { disabled, selected },
        onPress,
        disabled
      }),
    Sheet: ({ children }: any) => React.createElement(Native.View, {}, children)
  };
});

type Transport = React.ComponentProps<typeof TablaturePanel>["transport"];
const example: Tablature = {
  version: 1,
  tempo: 80,
  beatsPerBar: 4,
  notes: [
    { string: 0, fret: 0, tick: 0 },
    { string: 5, fret: 7, tick: 24 },
    { string: 2, fret: 2, tick: 96 }
  ]
};
const mockTransport = (tab = example): Transport => ({
  tab,
  tick: 0,
  status: "idle",
  error: null,
  speed: 1,
  loop: false,
  range: null,
  setTab: jest.fn(),
  play: jest.fn().mockResolvedValue(undefined),
  pause: jest.fn(),
  rewind: jest.fn(),
  startRecording: jest.fn(),
  stopRecording: jest.fn(),
  capture: jest.fn(),
  setSpeed: jest.fn(),
  setLoop: jest.fn(),
  setRange: jest.fn()
});
const props = (transport = mockTransport()) => ({
  transport,
  dirty: false,
  expanded: true,
  onToggle: jest.fn(),
  onOpen: jest.fn(),
  onSave: jest.fn(),
  onRecord: jest.fn()
});
const button = (screen: Renderer.ReactTestRenderer, label: string) =>
  screen.root
    .findAll((node) => typeof node.props.onPress === "function")
    .find((node) => node.props.accessibilityLabel === label)!;
const press = async (screen: Renderer.ReactTestRenderer, label: string) => {
  const target = button(screen, label);
  expect(target).toBeDefined();
  expect(target.props.disabled).not.toBe(true);
  await act(async () => target.props.onPress());
};
let screen: Renderer.ReactTestRenderer | undefined;
afterEach(async () => {
  if (screen) await act(async () => screen?.unmount());
  screen = undefined;
});

test("compact panel dispatches open, recording, save and playback independently", async () => {
  const value = props();
  await act(async () => {
    screen = Renderer.create(<TablaturePanel {...value} />);
  });
  await press(screen!, "TabOpen");
  await press(screen!, "TabRecord");
  await press(screen!, "TabSave");
  await press(screen!, "TabPlay");
  expect(value.onOpen).toHaveBeenCalledTimes(1);
  expect(value.onRecord).toHaveBeenCalledTimes(1);
  expect(value.onSave).toHaveBeenCalledTimes(1);
  expect(value.transport.play).toHaveBeenCalledTimes(1);
});

test("an empty tablature cannot be saved or played but can be recorded", async () => {
  const value = props(mockTransport(emptyTablature()));
  await act(async () => {
    screen = Renderer.create(<TablaturePanel {...value} />);
  });
  expect(button(screen!, "TabSave").props.disabled).toBe(true);
  expect(button(screen!, "TabPlay").props.disabled).toBe(true);
  await press(screen!, "TabRecord");
  expect(value.onRecord).toHaveBeenCalledTimes(1);
});

test("recording exposes stop and prevents opening or saving an unfinished take", async () => {
  const transport = { ...mockTransport(), status: "recording" as const };
  const value = props(transport);
  await act(async () => {
    screen = Renderer.create(<TablaturePanel {...value} />);
  });
  expect(button(screen!, "TabOpen").props.disabled).toBe(true);
  expect(button(screen!, "TabSave").props.disabled).toBe(true);
  await press(screen!, "TabStopRecording");
  expect(transport.stopRecording).toHaveBeenCalledTimes(1);
  expect(value.onRecord).not.toHaveBeenCalled();
});

test("tablature rows run from high e to low E and preserve string/fret identity", async () => {
  const onNote = jest.fn();
  await act(async () => {
    screen = Renderer.create(
      <TablatureBar tab={example} bar={0} tick={0} onNote={onNote} />
    );
  });
  const rows = screen!.root
    .findAllByType(View)
    .filter(
      (node) =>
        typeof node.props.testID === "string" &&
        node.props.testID.startsWith("tablature-string-")
    );
  expect(rows.map((node) => node.props.testID)).toEqual([
    "tablature-string-5",
    "tablature-string-4",
    "tablature-string-3",
    "tablature-string-2",
    "tablature-string-1",
    "tablature-string-0"
  ]);
  const high = rows[0].find((node) => typeof node.props.onPress === "function");
  expect(high.props.accessibilityLabel).toContain('"string":1,"fret":7');
  await act(async () => high.props.onPress());
  expect(onNote).toHaveBeenCalledWith(example.notes[1]);
  expect(
    rows[5].find((node) => typeof node.props.onPress === "function").props
      .accessibilityLabel
  ).toContain('"string":6,"fret":0');
});

test("selected note can change fret and string, then be deleted without changing other notes", async () => {
  const updates: Tablature[] = [];
  const base = mockTransport();
  function Editor() {
    const [tab, setTab] = useState(example);
    return (
      <TablaturePanel
        {...props({
          ...base,
          tab,
          setTab: (next) => {
            updates.push(next);
            setTab(next);
          }
        })}
      />
    );
  }
  await act(async () => {
    screen = Renderer.create(<Editor />);
  });
  const note = screen!.root
    .findAll((node) => typeof node.props.onPress === "function")
    .find((node) =>
      node.props.accessibilityLabel?.includes('"string":1,"fret":7')
    )!;
  await act(async () => note.props.onPress());
  await press(screen!, "TabFret: +");
  expect(updates.at(-1)!.notes).toContainEqual({
    string: 5,
    fret: 8,
    tick: 24
  });
  await press(screen!, "TabString: +");
  expect(updates.at(-1)!.notes).toContainEqual({
    string: 4,
    fret: 8,
    tick: 24
  });
  await press(screen!, "TabNoteLater");
  expect(updates.at(-1)!.notes).toContainEqual({
    string: 4,
    fret: 8,
    tick: 30
  });
  await press(screen!, "TabDeleteNote");
  expect(updates.at(-1)!.notes).toEqual([example.notes[0], example.notes[2]]);
  expect(base.pause).toHaveBeenCalled();
});

test("moving onto an occupied string and time preserves both notes", async () => {
  const transport = mockTransport({
    ...example,
    notes: [
      { string: 5, fret: 7, tick: 24 },
      { string: 4, fret: 5, tick: 24 }
    ]
  });
  await act(async () => {
    screen = Renderer.create(<TablaturePanel {...props(transport)} />);
  });
  const note = screen!.root
    .findAll((node) => typeof node.props.onPress === "function")
    .find((node) =>
      node.props.accessibilityLabel?.includes('"string":1,"fret":7')
    )!;
  await act(async () => note.props.onPress());
  await press(screen!, "TabString: +");
  expect(transport.setTab).not.toHaveBeenCalled();
  expect(JSON.stringify(screen!.toJSON())).toContain("TabNoteCollision");
});

test("speed and a one-bar repeat are passed to the transport in musical ticks", async () => {
  const transport = mockTransport();
  await act(async () => {
    screen = Renderer.create(<TablaturePanel {...props(transport)} />);
  });
  await press(screen!, "TabFullView");
  await press(screen!, 'TabSpeedPercent:{"percent":50}');
  expect(transport.setSpeed).toHaveBeenCalledWith(0.5);
  await press(screen!, "TabRangeTo: −");
  expect(transport.setRange).toHaveBeenCalledWith({ start: 0, end: 96 });
  expect(transport.setLoop).toHaveBeenCalledWith(true);
});
