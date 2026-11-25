import React, { useState } from "react";
import Renderer, { act } from "react-test-renderer";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import {
  TablatureBar,
  TablaturePanel
} from "../src/screens/play/tablature-panel";
import {
  TAB_MAX_NOTES,
  Tablature,
  emptyTablature,
  normalizeTablature
} from "../src/components/tablature";
import { defaultTabPractice } from "../src/components/tablature-practice";

const mockPreview = jest.fn();
const mockCancelPreview = jest.fn();
jest.mock("../src/screens/play/use-tablature-preview", () => ({
  useTablaturePreview: () => ({
    preview: mockPreview,
    cancelPreview: mockCancelPreview
  })
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, number>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
  })
}));
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 }))
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
    Sheet: ({ children, toolbar, footer, headerAccessory }: any) =>
      React.createElement(Native.View, {}, headerAccessory, toolbar, children, footer),
    TempoControl: ({
      value,
      onChange,
      label,
      accessibilityLabel,
      disabled
    }: any) =>
      React.createElement(
        Native.View,
        {},
        ...[-1, 1].map((direction) =>
          React.createElement(Native.Pressable, {
            key: direction,
            accessibilityLabel: `${accessibilityLabel ?? label}: ${direction < 0 ? "−" : "+"}`,
            disabled: disabled || (direction < 0 ? value <= 40 : value >= 200),
            onPress: () =>
              onChange(Math.max(40, Math.min(200, value + direction * 5)))
          })
        )
      )
  };
});

type Transport = React.ComponentProps<typeof TablaturePanel>["transport"];
const example: Tablature = normalizeTablature({
  version: 1,
  tempo: 80,
  beatsPerBar: 4,
  notes: [
    { string: 0, fret: 0, tick: 0 },
    { string: 5, fret: 7, tick: 24 },
    { string: 2, fret: 2, tick: 96 }
  ]
})!;
const mockTransport = (tab = example): Transport => ({
  tab,
  tick: 0,
  status: "idle",
  error: null,
  speed: 1,
  loop: false,
  range: null,
  canUndo: false,
  canRedo: false,
  practice: defaultTabPractice(),
  practiceBpm: tab.tempo,
  completedLoops: 0,
  countIn: null,
  undo: jest.fn(),
  redo: jest.fn(),
  replaceTab: jest.fn(),
  setTab: jest.fn().mockReturnValue(true),
  play: jest.fn().mockResolvedValue(undefined),
  pause: jest.fn(),
  rewind: jest.fn(),
  startRecording: jest.fn(),
  stopRecording: jest.fn(),
  capture: jest.fn(),
  setSpeed: jest.fn(),
  setLoop: jest.fn(),
  setRange: jest.fn(),
  setPractice: jest.fn(),
  seek: jest.fn()
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
  if (!button(screen, label)) {
    if (button(screen, "TabFullView"))
      await act(async () => button(screen, "TabFullView").props.onPress());
    if (/^TabFret: \d+$/.test(label) && button(screen, "TabShowKeypad"))
      await act(async () => button(screen, "TabShowKeypad").props.onPress());
    if (!button(screen, label)) {
      const section =
        [
          { pattern: /^Tab(Speed|QuarterTempo)/, label: "TabLoopShort" },
          { pattern: /^Tab(Range|Loop|WholePiece)/, label: "TabLoopShort" },
          {
            pattern:
              /^Tab(InsertBar|AppendBar|DuplicateBar|DeleteBar|CopyBar|PasteBar|Meter)/,
            label: "TabBars"
          }
        ].find((entry) => entry.pattern.test(label))?.label ?? "TabScore";
      await act(async () => button(screen, section).props.onPress());
      if (!button(screen, label) && button(screen, "TabMoreOptions"))
        await act(async () => button(screen, "TabMoreOptions").props.onPress());
    }
  }
  const target = button(screen, label);
  expect(target).toBeDefined();
  expect(target.props.disabled).not.toBe(true);
  await act(async () => target.props.onPress());
};
let screen: Renderer.ReactTestRenderer | undefined;
beforeEach(() => {
  mockPreview.mockClear();
  mockCancelPreview.mockClear();
  jest
    .mocked(useWindowDimensions)
    .mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 });
});
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

test("practice opens from the main panel and cannot overlap the editor modal", async () => {
  const value = { ...props(), onPractice: jest.fn() };
  await act(async () => {
    screen = Renderer.create(<TablaturePanel {...value} />);
  });
  await press(screen!, "TabPractice");
  expect(value.onPractice).toHaveBeenCalledTimes(1);
  await press(screen!, "TabFullView");
  expect(button(screen!, "TabPractice").props.disabled).toBe(true);
  await act(async () => button(screen!, "TabPractice").props.onPress());
  expect(value.onPractice).toHaveBeenCalledTimes(1);
});

test.each(["hydrating", "recording", "countingIn"] as const)(
  "%s prevents entering practice while keeping cancellation available",
  async (state) => {
    const transport = mockTransport();
    if (state === "recording") transport.status = "recording";
    if (state === "countingIn") {
      transport.status = "countingIn";
      transport.countIn = { bar: 1, beat: 2, bars: 1, target: "record" };
    }
    const value = {
      ...props(transport),
      onPractice: jest.fn(),
      disabled: state === "hydrating"
    };
    await act(async () => {
      screen = Renderer.create(<TablaturePanel {...value} />);
    });
    expect(button(screen!, "TabPractice").props.disabled).toBe(true);
    await act(async () => button(screen!, "TabPractice").props.onPress());
    expect(value.onPractice).not.toHaveBeenCalled();
    if (state === "recording") {
      await press(screen!, "TabStopRecording");
      expect(transport.stopRecording).toHaveBeenCalledTimes(1);
    } else if (state === "countingIn") {
      await press(screen!, "TabCancelCountIn");
      expect(transport.pause).toHaveBeenCalledTimes(1);
      expect(transport.startRecording).not.toHaveBeenCalled();
    }
  }
);

test("play count-in locks editing and keeps Cancel accessible", async () => {
  const transport = {
    ...mockTransport(),
    status: "countingIn" as const,
    countIn: { bar: 1, beat: 3, bars: 2, target: "play" as const }
  };
  await act(async () => {
    screen = Renderer.create(<TablaturePanel {...props(transport)} />);
  });
  expect(button(screen!, "TabOpen").props.disabled).toBe(true);
  expect(button(screen!, "TabSave").props.disabled).toBe(true);
  expect(button(screen!, "TabFullView").props.disabled).toBe(true);
  await press(screen!, "TabCancelCountIn");
  expect(transport.pause).toHaveBeenCalledTimes(1);
  expect(transport.play).not.toHaveBeenCalled();
});

test("readonly bars ignore supplied edit callbacks and expose notes as text", async () => {
  const onNote = jest.fn();
  const onCell = jest.fn();
  const onRest = jest.fn();
  await act(async () => {
    screen = Renderer.create(
      <TablatureBar
        tab={example}
        bar={0}
        tick={0}
        readOnly
        onNote={onNote}
        onCell={onCell}
        onRest={onRest}
      />
    );
  });
  const targets = screen!.root.findAll(
    (node) => typeof node.props.onPress === "function"
  );
  expect(targets).toHaveLength(0);
  const notes = screen!.root.findAll(
    (node) => node.props.accessibilityRole === "text"
  );
  expect(notes.length).toBeGreaterThan(0);
  expect(onNote).not.toHaveBeenCalled();
  expect(onCell).not.toHaveBeenCalled();
  expect(onRest).not.toHaveBeenCalled();
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
            return true;
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
  await press(screen!, "TabFret: 8");
  expect(updates.at(-1)!.notes).toContainEqual({
    string: 5,
    fret: 8,
    tick: 24,
    duration: 24
  });
  await press(screen!, "TabString ↓");
  expect(updates.at(-1)!.notes).toContainEqual({
    string: 4,
    fret: 8,
    tick: 24,
    duration: 24
  });
  expect(
    mockPreview.mock.calls.map(([note]) => [note.string, note.fret])
  ).toEqual([
    [5, 7],
    [5, 8],
    [4, 8]
  ]);
  await press(screen!, "TabDeleteNote");
  expect(updates.at(-1)!.notes).toEqual([example.notes[0], example.notes[2]]);
  expect(mockPreview).toHaveBeenCalledTimes(3);
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
  await press(screen!, "TabString ↓");
  expect(transport.setTab).not.toHaveBeenCalled();
  expect(mockPreview).toHaveBeenCalledTimes(1);
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

async function editable(initial = emptyTablature()) {
  const updates: Tablature[] = [];
  const base = mockTransport(initial);
  function Editor() {
    const [tab, setTab] = useState(initial);
    return (
      <TablaturePanel
        {...props({
          ...base,
          tab,
          setTab: (next) => {
            const normalized = normalizeTablature(next);
            if (!normalized) return false;
            updates.push(normalized);
            setTab(normalized);
            return true;
          }
        })}
      />
    );
  }
  await act(async () => {
    screen = Renderer.create(<Editor />);
  });
  await press(screen!, "TabFullView");
  return { updates, base };
}

const pressNote = async (string: number, fret: number) => {
  const target = screen!.root
    .findAll((node) => typeof node.props.onPress === "function")
    .find((node) =>
      node.props.accessibilityLabel?.includes(
        `"string":${string},"fret":${fret}`
      )
    )!;
  await act(async () => target.props.onPress());
};

test("the note sheet switches compact tabs without losing chord settings", async () => {
  const initial = normalizeTablature({ ...emptyTablature(), notes: [
    { string: 5, fret: 7, tick: 0, duration: 24 },
    { string: 3, fret: 5, tick: 0, duration: 24 },
    { string: 2, fret: 2, tick: 48, duration: 24 }
  ] })!;
  const { updates } = await editable(initial);
  await pressNote(1, 7);
  await press(screen!, "TabScore");
  expect(button(screen!, "TabTechnique_bend")).toBeUndefined();
  expect(button(screen!, 'TabDurationChoice:{"denominator":4}')).toBeDefined();
  expect(button(screen!, "f")).toBeUndefined();
  await press(screen!, "TabScopeChord");
  await press(screen!, "TabTechniqueTab");
  expect(button(screen!, 'TabDurationChoice:{"denominator":4}')).toBeUndefined();
  await press(screen!, "TabTechnique_bend");
  await press(screen!, "1.5 TabTone");
  expect(updates.at(-1)?.notes.filter((note) => note.tick === 0).every((note) => note.techniques?.includes("bend") && note.bend === 1.5)).toBe(true);
  expect(updates.at(-1)?.notes.find((note) => note.tick === 48)?.techniques).toBeUndefined();
  await press(screen!, "TabDynamics");
  await press(screen!, "f");
  expect(updates.at(-1)?.notes.filter((note) => note.tick === 0).every((note) => note.velocity === 82)).toBe(true);
  await press(screen!, "TabClearEffects");
  expect(updates.at(-1)?.notes.filter((note) => note.tick === 0).every((note) => !note.techniques && note.velocity === undefined)).toBe(true);
});

test("an expressive note keeps its settings while entering a new two-digit fret", async () => {
  const initial = normalizeTablature({ ...emptyTablature(), version: 3, notes: [
    { string: 5, fret: 7, tick: 0, duration: 12, velocity: 40, techniques: ["vibrato"] }
  ] })!;
  const { updates } = await editable(initial);
  await pressNote(1, 7);
  await press(screen!, "TabFret: 1");
  await press(screen!, "TabFret: 2");
  expect(updates.at(-1)?.notes[0]).toMatchObject({ fret: 12, velocity: 40, techniques: ["vibrato"], duration: 12 });
});

test("the note sheet omits position controls while retaining rhythm settings", async () => {
  await editable();
  await press(screen!, "TabScore");
  for (const label of ["TabChooseStringMenu", "TabFret: +", "TabFret: −", "TabNoteEarlier", "TabNoteLater"])
    expect(button(screen!, label)).toBeUndefined();
  expect(button(screen!, 'TabDurationChoice:{"denominator":4}')).toBeDefined();
});

test("dragging attack commits one edit on release rather than every pointer movement", async () => {
  const { updates } = await editable(example);
  await pressNote(1, 7);
  await press(screen!, "TabScore");
  await press(screen!, "TabDynamics");
  const slider = screen!.root.findAll((node) => node.props.accessibilityRole === "adjustable" && node.props.accessibilityLabel === "TabAttack")[0];
  await act(async () => slider.props.onLayout({ nativeEvent: { layout: { width: 100 } } }));
  await act(async () => {
    slider.props.onResponderGrant({ nativeEvent: { locationX: 10 } });
    slider.props.onResponderMove({ nativeEvent: { locationX: 50 } });
    slider.props.onResponderMove({ nativeEvent: { locationX: 75 } });
  });
  expect(updates).toHaveLength(0);
  await act(async () => slider.props.onResponderRelease());
  expect(updates).toHaveLength(1);
  expect(updates[0].notes.find((note) => note.fret === 7)?.velocity).toBe(96);
});

test("staff taps and the keypad compose chords and two-digit frets with the last duration", async () => {
  const { updates } = await editable();
  await press(screen!, 'TabDurationChoice:{"denominator":8}');
  const { Sheet } = require("../src/screens/song/tools");
  await act(async () =>
    screen!.root.findAllByType(Sheet).at(-1)!.props.onClose()
  );
  await press(screen!, "TabFret: 7");
  await press(screen!, 'TabEmptyCell:{"string":2,"bar":1,"beat":1}');
  await press(screen!, "TabFret: 5");
  expect(updates.at(-1)!.notes).toEqual([
    { string: 4, fret: 5, tick: 0, duration: 12 },
    { string: 5, fret: 7, tick: 0, duration: 12 }
  ]);
  await press(screen!, "TabNextPosition");
  await press(screen!, "TabFret: 1");
  await press(screen!, "TabFret: 2");
  expect(updates.at(-1)!.notes).toContainEqual({
    string: 4,
    fret: 12,
    tick: 12,
    duration: 12
  });
  await pressNote(2, 5);
  await press(screen!, "TabFret: 3");
  expect(updates.at(-1)!.notes).toContainEqual({
    string: 4,
    fret: 3,
    tick: 0,
    duration: 12
  });
  expect(updates.at(-1)!.notes).toHaveLength(3);
  expect(mockPreview.mock.calls.map(([note]) => note.fret)).toEqual([
    7, 5, 1, 12, 5, 3
  ]);
});

test("rejected note writes stay silent and leave the document unchanged", async () => {
  const transport = mockTransport(emptyTablature());
  transport.setTab = jest.fn().mockReturnValue(false);
  await act(async () => {
    screen = Renderer.create(<TablaturePanel {...props(transport)} />);
  });
  await press(screen!, "TabFret: 9");
  expect(transport.setTab).toHaveBeenCalledTimes(1);
  expect(mockPreview).not.toHaveBeenCalled();
  expect(JSON.stringify(screen!.toJSON())).toContain("TabInvalidData");
});

test("playback, recording and collapse cancel note previews before handing off", async () => {
  const transport = mockTransport();
  const value = props(transport);
  await act(async () => {
    screen = Renderer.create(<TablaturePanel {...value} />);
  });
  for (const [label, action] of [
    ["TabPlay", transport.play],
    ["TabRecord", value.onRecord],
    ["TabCollapse", value.onToggle]
  ] as const) {
    await pressNote(1, 7);
    mockCancelPreview.mockClear();
    await press(screen!, label);
    expect(mockCancelPreview).toHaveBeenCalledTimes(1);
    expect(mockCancelPreview.mock.invocationCallOrder[0]).toBeLessThan(
      (action as jest.Mock).mock.invocationCallOrder[0]
    );
  }
});

test("inline tempo arrows update the score without opening a settings sheet", async () => {
  const { updates } = await editable(example);
  const { Sheet } = require("../src/screens/song/tools");
  const sheets = screen!.root.findAllByType(Sheet).length;
  await press(screen!, "TabQuarterTempo: +");
  expect(updates.at(-1)).toMatchObject({ tempo: 85, notes: example.notes });
  expect(screen!.root.findAllByType(Sheet)).toHaveLength(sheets);
  await press(screen!, "TabQuarterTempo: −");
  expect(updates.at(-1)?.tempo).toBe(80);
});

test("pausing after playback changes bar keeps insertion on the displayed bar", async () => {
  const transport = mockTransport({ ...example, barCount: 3 });
  await act(async () => {
    screen = Renderer.create(
      <TablaturePanel
        {...props({ ...transport, status: "playing", tick: 192 })}
      />
    );
  });
  await act(async () => {
    screen!.update(<TablaturePanel {...props({ ...transport, tick: 192 })} />);
  });
  await press(screen!, "TabFullView");
  const bar = screen!.root
    .findAllByType(TablatureBar)
    .find((entry) => !entry.props.compact)!;
  expect(bar.props.bar).toBe(2);
  expect(bar.props.selected).toMatchObject({ tick: 192 });
  await press(screen!, "TabAddNote");
  expect(transport.setTab).toHaveBeenCalledWith(
    expect.objectContaining({
      notes: expect.arrayContaining([
        expect.objectContaining({ string: 5, tick: 192 })
      ])
    })
  );
});

test("rewinding the editor moves its insertion cursor back with the displayed bar", async () => {
  const { updates } = await editable(example);
  await press(screen!, "TabNextBar");
  await press(screen!, "TabRewind");
  const bar = screen!.root
    .findAllByType(TablatureBar)
    .find((entry) => !entry.props.compact)!;
  expect(bar.props.bar).toBe(0);
  expect(bar.props.selected).toMatchObject({ tick: 0 });
  await press(screen!, "TabAddNote");
  expect(updates.at(-1)!.notes).toContainEqual({
    string: 5,
    fret: 0,
    tick: 0,
    duration: 24
  });
});

test("pausing just after a bar boundary follows the final transport position", async () => {
  const transport = mockTransport({ ...example, barCount: 3 });
  await act(async () => {
    screen = Renderer.create(
      <TablaturePanel
        {...props({ ...transport, status: "playing", tick: 95 })}
      />
    );
  });
  await act(async () => {
    screen!.update(<TablaturePanel {...props({ ...transport, tick: 97 })} />);
  });
  await press(screen!, "TabFullView");
  const bar = screen!.root
    .findAllByType(TablatureBar)
    .find((entry) => !entry.props.compact)!;
  expect(bar.props.bar).toBe(1);
  expect(bar.props.selected).toMatchObject({ tick: 96 });
});

test("a triplet insertion cursor remains visible between the selected grid positions", async () => {
  await editable();
  await press(screen!, 'TabDurationChoice:{"denominator":8}');
  await press(screen!, "TabTriplet");
  await press(screen!, "TabAddNote");
  const cursor = button(
    screen!,
    'TabEmptyCell:{"string":1,"bar":1,"beat":1.33}'
  );
  expect(cursor).toBeDefined();
  expect(cursor.props.accessibilityState.selected).toBe(true);
});

test("playing locks hidden note edits but preserves pause and playback preferences", async () => {
  const transport = { ...mockTransport(), canUndo: true };
  const value = props(transport);
  await act(async () => {
    screen = Renderer.create(<TablaturePanel {...value} />);
  });
  await pressNote(1, 7);
  await act(async () => {
    screen!.update(
      <TablaturePanel
        {...value}
        transport={{ ...transport, status: "playing", tick: 96 }}
      />
    );
  });
  await press(screen!, "TabScore");
  await press(screen!, "TabMoreOptions");
  for (const label of ["TabAddNote", "TabDeleteNote", "TabUndo"])
    expect(button(screen!, label).props.disabled).toBe(true);
  expect(button(screen!, "Pause").props.disabled).not.toBe(true);
  expect(button(screen!, "TabRewind").props.disabled).not.toBe(true);
  await press(screen!, "TabLoopShort");
  expect(button(screen!, "TabQuarterTempo: +").props.disabled).toBe(true);
  expect(
    button(screen!, 'TabSpeedPercent:{"percent":50}').props.disabled
  ).not.toBe(true);
  expect(button(screen!, "TabLoop").props.disabled).not.toBe(true);
  expect(transport.setTab).not.toHaveBeenCalled();
});

test("compact playback metadata shows the effective practice tempo", async () => {
  const transport = { ...mockTransport(), practiceBpm: 40, speed: 0.5 };
  await act(async () => {
    screen = Renderer.create(<TablaturePanel {...props(transport)} />);
  });
  expect(
    screen!.root.findAll((node) => node.props.children === "40 ♩ BPM · 4/4")
      .length
  ).toBeGreaterThan(0);
});

test("fixed speed is not marked selected while the progressive trainer controls tempo", async () => {
  const transport = mockTransport();
  transport.practice.trainer.enabled = true;
  await act(async () => {
    screen = Renderer.create(<TablaturePanel {...props(transport)} />);
  });
  await press(screen!, "TabFullView");
  await press(screen!, "TabLoopShort");
  expect(
    button(screen!, 'TabSpeedPercent:{"percent":100}').props.selected
  ).toBe(false);
});

test("deleting a retrigger cannot revive an earlier hidden sustain across a rest", async () => {
  const initial = normalizeTablature({
    ...emptyTablature(),
    notes: [
      { string: 5, fret: 3, tick: 0, duration: 96 },
      { string: 5, fret: 7, tick: 24, duration: 12 }
    ],
    rests: [{ tick: 36, duration: 12 }]
  })!;
  const { updates } = await editable(initial);
  await pressNote(1, 7);
  await press(screen!, "TabDeleteNote");
  expect(updates).toHaveLength(1);
  expect(updates[0].notes).toEqual([
    { string: 5, fret: 3, tick: 0, duration: 24 }
  ]);
  expect(updates[0].rests).toEqual(initial.rests);
});

test("moving a retrigger to another string preserves the original release before a rest", async () => {
  const initial = normalizeTablature({
    ...emptyTablature(),
    notes: [
      { string: 5, fret: 3, tick: 0, duration: 96 },
      { string: 5, fret: 7, tick: 24, duration: 12 }
    ],
    rests: [{ tick: 36, duration: 12 }]
  })!;
  const { updates } = await editable(initial);
  await pressNote(1, 7);
  await press(screen!, "TabString ↓");
  expect(updates).toHaveLength(1);
  expect(updates[0].notes).toEqual([
    { string: 5, fret: 3, tick: 0, duration: 24 },
    { string: 4, fret: 7, tick: 24, duration: 12 }
  ]);
});

test("an empty editor composes a note and a silent rest without virtual guitar touches", async () => {
  const { updates } = await editable();
  await press(screen!, 'TabDurationChoice:{"denominator":8}');
  await press(screen!, "TabFret: 2");
  expect(updates.at(-1)!.notes).toEqual([
    { string: 5, fret: 2, tick: 0, duration: 12 }
  ]);
  await press(screen!, "TabNextPosition");
  await press(screen!, "TabAddRest");
  expect(updates.at(-1)!.rests).toEqual([{ tick: 12, duration: 12 }]);
  expect(mockPreview).toHaveBeenCalledTimes(1);
  expect(mockPreview).toHaveBeenCalledWith({
    string: 5,
    fret: 2,
    tick: 0,
    duration: 12
  });
  expect(button(screen!, "TabSave").props.disabled).toBe(false);
  expect(button(screen!, "TabPlay").props.disabled).toBe(false);
});

test("chord entry stays at one onset when advance is off and another string is chosen", async () => {
  const { updates } = await editable();
  await press(screen!, "TabAdvanceCursor");
  await press(screen!, "TabAddNote");
  await press(screen!, 'TabEmptyCell:{"string":2,"bar":1,"beat":1}');
  await press(screen!, "TabAddNote");
  expect(updates.at(-1)!.notes).toEqual([
    { string: 4, fret: 0, tick: 0, duration: 24 },
    { string: 5, fret: 0, tick: 0, duration: 24 }
  ]);
});

test("selected notes support dotted values and triplets", async () => {
  const { updates } = await editable(example);
  await pressNote(1, 7);
  await press(screen!, 'TabDurationChoice:{"denominator":8}');
  await press(screen!, "TabDotted");
  expect(updates.at(-1)!.notes.find((note) => note.fret === 7)?.duration).toBe(
    18
  );
  await press(screen!, "TabTriplet");
  expect(updates.at(-1)!.notes.find((note) => note.fret === 7)?.duration).toBe(
    8
  );

});

test("a conflicting rest does not erase or truncate a sounding note", async () => {
  const initial = normalizeTablature({
    ...emptyTablature(),
    notes: [{ string: 5, fret: 3, tick: 0, duration: 24 }]
  })!;
  const { updates } = await editable(initial);
  await press(screen!, 'TabEmptyCell:{"string":2,"bar":1,"beat":1}');
  await press(screen!, "TabAddRest");
  expect(updates).toHaveLength(0);
  expect(mockPreview).not.toHaveBeenCalled();
  expect(JSON.stringify(screen!.toJSON())).toContain("TabRestCollision");
});

test("four quarters fill one bar without adding an unintended silent loop bar", async () => {
  const { updates } = await editable();
  for (let note = 0; note < 4; note++) await press(screen!, "TabAddNote");
  expect(updates.at(-1)!.notes.map((note) => note.tick)).toEqual([
    0, 24, 48, 72
  ]);
  expect(updates.at(-1)!.barCount).toBe(1);
  await press(screen!, "TabShowKeypad");
  expect(button(screen!, "TabDeleteNote")).toBeDefined();
  await press(screen!, "TabAppendBar");
  await press(screen!, "TabAddNote");
  expect(updates.at(-1)!.notes[4]).toMatchObject({ tick: 96, duration: 24 });
  expect(updates.at(-1)!.barCount).toBe(2);
});

test("duplicate and delete bar controls preserve surrounding attacks", async () => {
  const initial = normalizeTablature({
    ...emptyTablature(),
    notes: [{ string: 5, fret: 3, tick: 0, duration: 24 }]
  })!;
  const { updates } = await editable(initial);
  await press(screen!, "TabDuplicateBar");
  expect(updates.at(-1)!).toMatchObject({
    barCount: 2,
    notes: [
      { string: 5, fret: 3, tick: 0, duration: 24 },
      { string: 5, fret: 3, tick: 96, duration: 24 }
    ]
  });
  await press(screen!, "TabDeleteBar");
  expect(updates.at(-1)!).toEqual(initial);
});

test("six-eight changes bar boundaries and loop lengths using eighth-note beats", async () => {
  const { updates, base } = await editable(example);
  await press(screen!, 'TabMeterValue:{"beats":6,"unit":8}');
  expect(updates.at(-1)!).toMatchObject({
    beatUnit: 8,
    beatsPerBar: 6,
    barCount: 3,
    notes: example.notes
  });
  await press(screen!, "TabRangeTo: −");
  expect(base.setRange).toHaveBeenCalledWith({ start: 0, end: 144 });
  expect(button(screen!, "TabQuarterTempo: +")).toBeDefined();
});

test("history controls call transport undo and redo, and all editing locks while recording", async () => {
  const transport = { ...mockTransport(), canUndo: true, canRedo: true };
  const value = props(transport);
  await act(async () => {
    screen = Renderer.create(<TablaturePanel {...value} />);
  });
  await press(screen!, "TabFullView");
  await press(screen!, "TabUndo");
  await press(screen!, "TabRedo");
  expect(transport.undo).toHaveBeenCalledTimes(1);
  expect(transport.redo).toHaveBeenCalledTimes(1);
  await act(async () => {
    screen!.update(
      <TablaturePanel
        {...value}
        transport={{ ...transport, status: "recording" }}
      />
    );
  });
  for (const [section, labels] of [
    ["TabScore", ["TabUndo", "TabRedo", "TabAddNote", "TabTriplet"]],
    ["TabBars", ["TabDuplicateBar", 'TabMeterValue:{"beats":6,"unit":8}']],
    ["TabLoopShort", ["TabQuarterTempo: +"]]
  ] as const) {
    await press(screen!, section);
    if (section === "TabScore") await press(screen!, "TabMoreOptions");
    for (const label of labels)
      expect(button(screen!, label).props.disabled).toBe(true);
  }
  expect(button(screen!, "TabStopRecording").props.disabled).not.toBe(true);
});

test("draft hydration disables opening, editing, recording, saving and playback", async () => {
  const value = props();
  await act(async () => {
    screen = Renderer.create(<TablaturePanel {...value} disabled />);
  });
  for (const label of [
    "TabOpen",
    "TabFullView",
    "TabRecord",
    "TabSave",
    "TabPlay"
  ])
    expect(button(screen!, label).props.disabled).toBe(true);
});

test("sustained notes and rests remain visible and selectable in subsequent bars", async () => {
  const tab = normalizeTablature({
    ...emptyTablature(80, 6, 8),
    notes: [{ string: 5, fret: 7, tick: 60, duration: 24 }],
    rests: [{ tick: 96, duration: 72 }]
  })!;
  const onNote = jest.fn();
  const onRest = jest.fn();
  await act(async () => {
    screen = Renderer.create(
      <TablatureBar
        tab={tab}
        bar={1}
        tick={72}
        onNote={onNote}
        onRest={onRest}
      />
    );
  });
  const continuedNote = screen!.root
    .findAll((node) => typeof node.props.onPress === "function")
    .find((node) =>
      node.props.accessibilityLabel?.startsWith(
        "TabContinuation, TabNoteDescription"
      )
    )!;
  expect(continuedNote).toBeDefined();
  await act(async () => continuedNote.props.onPress());
  expect(onNote).toHaveBeenCalledWith(tab.notes[0]);
  await act(async () => {
    screen!.update(
      <TablatureBar
        tab={tab}
        bar={2}
        tick={144}
        onNote={onNote}
        onRest={onRest}
      />
    );
  });
  const continuedRest = screen!.root
    .findAll((node) => typeof node.props.onPress === "function")
    .find((node) =>
      node.props.accessibilityLabel?.startsWith(
        "TabContinuation, TabRestDescription"
      )
    )!;
  expect(continuedRest).toBeDefined();
  await act(async () => continuedRest.props.onPress());
  expect(onRest).toHaveBeenCalledWith(tab.rests![0]);
});

test("a reattacked string does not show the old note as continuing into a later bar", async () => {
  const tab = normalizeTablature({
    ...emptyTablature(80, 6, 8),
    notes: [
      { string: 5, fret: 7, tick: 0, duration: 144 },
      { string: 5, fret: 9, tick: 60, duration: 6 }
    ]
  })!;
  await act(async () => {
    screen = Renderer.create(
      <TablatureBar tab={tab} bar={1} tick={72} onNote={jest.fn()} />
    );
  });
  expect(
    screen!.root.findAll((node) => typeof node.props.onPress === "function")
  ).toHaveLength(0);
});

test("full-view playback follows its cursor instead of retaining the selected edit position", async () => {
  const transport = mockTransport();
  const value = props(transport);
  await act(async () => {
    screen = Renderer.create(<TablaturePanel {...value} />);
  });
  await press(screen!, "TabFullView");
  const staff = () =>
    screen!.root
      .findAllByType(TablatureBar)
      .find((node) => !node.props.compact)!;
  expect(staff().props.selected).not.toBeNull();
  await act(async () => {
    screen!.update(
      <TablaturePanel
        {...value}
        transport={{ ...transport, status: "playing", tick: 96 }}
      />
    );
  });
  expect(staff().props.selected).toBeNull();
  expect(staff().props.selectedRest).toBeNull();
  expect(staff().props.bar).toBe(1);
});

test.each([false, true])(
  "system text enlargement scales the %s compact staff geometry",
  async (compact) => {
    await act(async () => {
      screen = Renderer.create(
        <TablatureBar
          tab={example}
          bar={0}
          tick={0}
          compact={compact}
          onNote={jest.fn()}
        />
      );
    });
    const rowHeight = () =>
      StyleSheet.flatten(
        screen!.root
          .findAllByType(View)
          .find((node) => node.props.testID === "tablature-string-5")!.props
          .style
      ).height;
    const normal = rowHeight();
    jest
      .mocked(useWindowDimensions)
      .mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 2 });
    await act(async () => {
      screen!.update(
        <TablatureBar
          tab={example}
          bar={0}
          tick={0}
          compact={compact}
          onNote={jest.fn()}
        />
      );
    });
    expect(rowHeight()).toBe(normal * 2);
  }
);

test("moving the insertion cursor and grid does not reread offscreen score notes", async () => {
  const tab = normalizeTablature({
    ...emptyTablature(),
    notes: Array.from({ length: TAB_MAX_NOTES }, (_, index) => ({
      string: 0,
      fret: 0,
      tick: index * 6,
      duration: 6
    }))
  })!;
  let reads = 0;
  for (const note of tab.notes.slice(100)) {
    const tick = note.tick;
    Object.defineProperty(note, "tick", {
      get: () => {
        reads++;
        return tick;
      }
    });
  }
  const onCell = jest.fn();
  await act(async () => {
    screen = Renderer.create(
      <TablatureBar tab={tab} bar={0} tick={0} onCell={onCell} grid={6} />
    );
  });
  reads = 0;
  await act(async () => {
    screen!.update(
      <TablatureBar
        tab={tab}
        bar={0}
        tick={0}
        onCell={onCell}
        grid={12}
        selected={{ string: 5, tick: 3 }}
      />
    );
  });
  expect(
    button(screen!, 'TabEmptyCell:{"string":1,"bar":1,"beat":1.13}').props
      .accessibilityState.selected
  ).toBe(true);
  expect(reads).toBe(0);
});
