import React, { useState } from "react";
import Renderer, { act } from "react-test-renderer";
import { View } from "react-native";
import {
  TablatureBar,
  TablaturePanel
} from "../src/screens/play/tablature-panel";
import {
  Tablature,
  emptyTablature,
  normalizeTablature
} from "../src/components/tablature";
import { defaultTabPractice } from "../src/components/tablature-practice";

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
  await press(screen!, "TabFret: +");
  expect(updates.at(-1)!.notes).toContainEqual({
    string: 5,
    fret: 8,
    tick: 24,
    duration: 24
  });
  await press(screen!, "TabString: +");
  expect(updates.at(-1)!.notes).toContainEqual({
    string: 4,
    fret: 8,
    tick: 24,
    duration: 24
  });
  await press(screen!, "TabNoteLater");
  expect(updates.at(-1)!.notes).toContainEqual({
    string: 4,
    fret: 8,
    tick: 30,
    duration: 24
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

test("an empty editor composes a note and a silent rest without virtual guitar touches", async () => {
  const { updates } = await editable();
  await press(screen!, 'TabDurationChoice:{"denominator":8}');
  await press(screen!, "TabFret: +");
  await press(screen!, "TabFret: +");
  await press(screen!, "TabAddNote");
  expect(updates.at(-1)!.notes).toEqual([
    { string: 5, fret: 2, tick: 0, duration: 12 }
  ]);
  await press(screen!, "TabAddRest");
  expect(updates.at(-1)!.rests).toEqual([{ tick: 12, duration: 12 }]);
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

test("selected notes support dotted values, triplets and matching movement grid", async () => {
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
  await press(screen!, 'TabGridValue:{"value":"1/8 ×⅔"}');
  await press(screen!, "TabNoteLater");
  expect(updates.at(-1)!.notes.find((note) => note.fret === 7)).toMatchObject({
    tick: 32,
    duration: 8
  });
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
  expect(JSON.stringify(screen!.toJSON())).toContain("TabRestCollision");
});

test("four quarters fill one bar without adding an unintended silent loop bar", async () => {
  const { updates } = await editable();
  for (let note = 0; note < 4; note++) await press(screen!, "TabAddNote");
  expect(updates.at(-1)!.notes.map((note) => note.tick)).toEqual([
    0, 24, 48, 72
  ]);
  expect(updates.at(-1)!.barCount).toBe(1);
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
  expect(JSON.stringify(screen!.toJSON())).toContain("TabQuarterTempo");
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
  for (const label of [
    "TabUndo",
    "TabRedo",
    "TabFret: +",
    "TabTriplet",
    "TabDuplicateBar",
    "TabQuarterTempo: +",
    'TabMeterValue:{"beats":6,"unit":8}'
  ])
    expect(button(screen!, label).props.disabled).toBe(true);
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
