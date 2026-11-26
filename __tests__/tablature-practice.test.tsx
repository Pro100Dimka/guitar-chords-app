import React from "react";
import Renderer, { act } from "react-test-renderer";
import { FlatList, Modal, StyleSheet, useWindowDimensions } from "react-native";
import { TablaturePractice } from "../src/screens/play/tablature-practice";
import { TablatureBar } from "../src/screens/play/tablature-panel";
import { defaultTabPractice } from "../src/components/tablature-practice";
import { normalizeTablature } from "../src/components/tablature";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
  })
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View
}));
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 }))
}));
jest.mock("../src/screens/song/tools", () => ({
  Action: require("react-native").Pressable,
  Sheet: require("react-native").View
}));

type Transport = React.ComponentProps<typeof TablaturePractice>["transport"];
const example = normalizeTablature({
  version: 2,
  tempo: 80,
  beatsPerBar: 4,
  beatUnit: 4,
  barCount: 8,
  notes: [
    { string: 0, fret: 0, tick: 0, duration: 24 },
    { string: 5, fret: 7, tick: 24, duration: 96 },
    { string: 2, fret: 2, tick: 96, duration: 24 }
  ]
})!;
const mockTransport = (patch: Partial<Transport> = {}): Transport => ({
  tab: example,
  tick: 0,
  status: "idle",
  error: null,
  speed: 1,
  loop: false,
  range: null,
  canUndo: false,
  canRedo: false,
  practice: defaultTabPractice(),
  practiceBpm: 80,
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
  seek: jest.fn(),
  ...patch
});
let screen: Renderer.ReactTestRenderer | undefined;
let followScroll: jest.SpyInstance;
const close = jest.fn();
const label = (key: string, values: Record<string, unknown>) =>
  `${key}:${JSON.stringify(values)}`;
const button = (key: string) =>
  screen!.root
    .findAll((node) => typeof node.props.onPress === "function")
    .find((node) => node.props.accessibilityLabel === key)!;
const press = async (key: string) => {
  const node = button(key);
  expect(node).toBeDefined();
  expect(node.props.disabled).not.toBe(true);
  await act(async () => node.props.onPress());
};
const mount = async (
  transport: Transport,
  props: Partial<React.ComponentProps<typeof TablaturePractice>> = {}
) => {
  await act(async () => {
    screen = Renderer.create(
      <TablaturePractice
        transport={transport}
        active
        onClose={close}
        {...props}
      />
    );
  });
};
const update = async (transport: Transport) => {
  await act(async () => {
    screen!.update(
      <TablaturePractice transport={transport} active onClose={close} />
    );
  });
};
beforeEach(() => {
  close.mockClear();
  jest
    .mocked(useWindowDimensions)
    .mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 });
  followScroll = jest
    .spyOn(FlatList.prototype, "scrollToIndex")
    .mockImplementation(() => {});
});
afterEach(async () => {
  if (screen) await act(async () => screen?.unmount());
  screen = undefined;
  followScroll.mockRestore();
});

test("fullscreen practice renders several readonly bars and tapping a bar only seeks", async () => {
  const transport = mockTransport();
  await mount(transport, { title: "My exercise" });
  const modal = screen!.root.findByType(Modal);
  expect(modal.props.presentationStyle).toBe("fullScreen");
  expect(modal.props.supportedOrientations).toEqual(["landscape-right"]);
  const bars = screen!.root.findAllByType(TablatureBar);
  expect(bars.length).toBeGreaterThan(1);
  for (const bar of bars) {
    expect(bar.props.readOnly).toBe(true);
    expect(bar.props.onNote).toBeUndefined();
    expect(bar.props.onCell).toBeUndefined();
    expect(bar.props.onRest).toBeUndefined();
    expect(typeof bar.props.onSeek).toBe("function");
  }
  await press(label("TabPracticeSeekBar", { bar: 2 }));
  expect(transport.seek).toHaveBeenCalledWith(96);
  expect(transport.setTab).not.toHaveBeenCalled();
  expect(transport.replaceTab).not.toHaveBeenCalled();
  expect(transport.capture).not.toHaveBeenCalled();
  expect(transport.startRecording).not.toHaveBeenCalled();
  expect(button("TabAddNote")).toBeUndefined();
});

test("transport controls change playback preferences without editing the score", async () => {
  const transport = mockTransport();
  await mount(transport);
  await press("TabPlay");
  await press("TabRewind");
  await press("TabLoop");
  await press("TabMetronome");
  expect(transport.play).toHaveBeenCalledTimes(1);
  expect(transport.rewind).toHaveBeenCalledTimes(1);
  expect(transport.setLoop).toHaveBeenCalledWith(true);
  expect(transport.setPractice).toHaveBeenLastCalledWith({
    ...transport.practice,
    metronome: true
  });
  await update({ ...transport, status: "playing" });
  await press("Pause");
  expect(transport.pause).toHaveBeenCalledTimes(1);
  expect(transport.setTab).not.toHaveBeenCalled();
});

test("settings expose count-in, click volume, progressive tempo, manual speeds and bar range", async () => {
  const transport = mockTransport({
    practice: { ...defaultTabPractice(), countInBars: 1 }
  });
  await mount(transport);
  await press("TabPracticeSettings");
  await press("TabCountInTwo");
  expect(transport.setPractice).toHaveBeenLastCalledWith({
    ...transport.practice,
    countInBars: 2
  });
  await press("TabMetronomeVolume: +");
  expect(transport.setPractice).toHaveBeenLastCalledWith({
    ...transport.practice,
    volume: 0.8
  });
  await press("TabCountInBetweenLoops");
  expect(transport.setPractice).toHaveBeenLastCalledWith({
    ...transport.practice,
    countInBetweenLoops: true
  });
  await press("TabTrainerEnabled");
  expect(transport.setPractice).toHaveBeenLastCalledWith({
    ...transport.practice,
    trainer: { ...transport.practice.trainer, enabled: true }
  });
  await press("TabTrainerStart: +");
  expect(transport.setPractice).toHaveBeenLastCalledWith({
    ...transport.practice,
    trainer: { ...transport.practice.trainer, startBpm: 65 }
  });
  await press("TabTrainerTarget: +");
  expect(transport.setPractice).toHaveBeenLastCalledWith({
    ...transport.practice,
    trainer: { ...transport.practice.trainer, targetBpm: 105 }
  });
  await press("TabTrainerStep: +");
  expect(transport.setPractice).toHaveBeenLastCalledWith({
    ...transport.practice,
    trainer: { ...transport.practice.trainer, stepBpm: 6 }
  });
  await press("TabTrainerRepeats: +");
  expect(transport.setPractice).toHaveBeenLastCalledWith({
    ...transport.practice,
    trainer: { ...transport.practice.trainer, repeats: 4 }
  });
  await press(label("TabSpeedPercent", { percent: 75 }));
  expect(transport.setSpeed).toHaveBeenCalledWith(0.75);
  await press("TabRangeFrom: +");
  expect(transport.setRange).toHaveBeenCalledWith({ start: 96, end: 768 });
  expect(transport.setLoop).toHaveBeenCalledWith(true);
  await press("TabWholePiece");
  expect(transport.setRange).toHaveBeenLastCalledWith(null);
  expect(transport.setTab).not.toHaveBeenCalled();
});

test("manual vertical or horizontal scrolling stops following until Follow is pressed", async () => {
  const transport = mockTransport({ status: "playing" });
  await mount(transport);
  await act(async () => screen!.root.findByType(FlatList).props.onLayout());
  followScroll.mockClear();
  await update({ ...transport, tick: 192 });
  expect(followScroll).toHaveBeenLastCalledWith({
    index: 1,
    animated: true,
    viewPosition: 0
  });
  await act(async () =>
    screen!.root.findByType(FlatList).props.onScrollBeginDrag()
  );
  followScroll.mockClear();
  await update({ ...transport, tick: 288 });
  expect(followScroll).not.toHaveBeenCalled();
  expect(
    screen!.root
      .findAllByType(TablatureBar)
      .every((bar) => !bar.props.followPlayback)
  ).toBe(true);
  await press("TabPracticeFollow");
  expect(followScroll).toHaveBeenLastCalledWith({
    index: 1,
    animated: true,
    viewPosition: 0
  });
  await act(async () =>
    screen!.root.findAllByType(TablatureBar)[0].props.onManualScroll()
  );
  expect(button("TabPracticeFollow")).toBeDefined();
  followScroll.mockClear();
  await update({ ...transport, tick: 384 });
  expect(followScroll).not.toHaveBeenCalled();
});

test("6/8 count-in shows six beats, locks settings and can be cancelled before recording", async () => {
  const transport = mockTransport({
    tab: { ...example, beatsPerBar: 6, beatUnit: 8 },
    status: "countingIn",
    countIn: { bar: 1, beat: 4, bars: 2, target: "record" }
  });
  await mount(transport);
  const beats = screen!.root.findAll(
    (node) =>
      typeof node.props.testID === "string" &&
      node.props.testID.startsWith("practice-count-beat-") &&
      typeof node.type === "string"
  );
  expect(beats).toHaveLength(6);
  await press("TabCancelCountIn");
  expect(transport.pause).toHaveBeenCalledTimes(1);
  expect(transport.play).not.toHaveBeenCalled();
  expect(transport.startRecording).not.toHaveBeenCalled();
  await press("TabPracticeSettings");
  expect(button("TabCountInTwo").props.disabled).toBe(true);
  expect(button("TabTrainerEnabled").props.disabled).toBe(true);
  expect(button("TabMetronomeVolume: +").props.disabled).toBe(true);
});

test("preparing audio keeps Cancel accessible and native back closes settings before practice", async () => {
  const transport = mockTransport({ status: "preparing" });
  await mount(transport);
  await press("TabCancelPreparing");
  expect(transport.pause).toHaveBeenCalledTimes(1);
  await press("TabPracticeSettings");
  await act(async () => screen!.root.findByType(Modal).props.onRequestClose());
  expect(button("TabCountInTwo")).toBeUndefined();
  expect(close).not.toHaveBeenCalled();
  await act(async () => screen!.root.findByType(Modal).props.onRequestClose());
  expect(close).toHaveBeenCalledTimes(1);
});

test("bounds prevent impossible ranges, out-of-range seeking and excessive practice values", async () => {
  const transport = mockTransport({
    range: { start: 96, end: 192 },
    practice: {
      ...defaultTabPractice(),
      volume: 1,
      trainer: {
        enabled: true,
        startBpm: 300,
        targetBpm: 300,
        stepBpm: 20,
        repeats: 16
      }
    }
  });
  await mount(transport);
  await act(async () =>
    button(label("TabPracticeSeekBar", { bar: 1 })).props.onPress()
  );
  expect(transport.seek).not.toHaveBeenCalled();
  await press("TabPracticeSettings");
  for (const name of [
    "TabTrainerStart: +",
    "TabTrainerTarget: +",
    "TabTrainerTarget: −",
    "TabTrainerStep: +",
    "TabTrainerRepeats: +",
    "TabMetronomeVolume: +",
    "TabRangeFrom: +",
    "TabRangeTo: −"
  ]) {
    expect(button(name).props.disabled).toBe(true);
  }
  expect(button("TabCountInBetweenLoops").props.disabled).toBe(true);
});

test("landscape packs compact bars into systems and follows the final system", async () => {
  jest
    .mocked(useWindowDimensions)
    .mockReturnValue({ width: 844, height: 390, scale: 1, fontScale: 1 });
  const transport = mockTransport({
    tab: { ...example, barCount: 5 },
    tick: 100000
  });
  await mount(transport);
  const reader = screen!.root.findByType(FlatList);
  expect(reader.props.data).toEqual([[0, 1, 2, 3], [4]]);
  await act(async () => reader.props.onLayout());
  expect(followScroll).toHaveBeenLastCalledWith({
    index: 1,
    animated: true,
    viewPosition: 0
  });
  const before = reader.props.getItemLayout(null, 0);
  while (!button("TabPracticeLarger").props.disabled)
    await press("TabPracticeLarger");
  const enlarged = screen!.root.findByType(FlatList);
  const after = enlarged.props.getItemLayout(null, 0);
  expect(after.length).toBeGreaterThan(before.length);
  expect(enlarged.props.getItemLayout(null, 1).offset).toBe(after.length);
  expect(button("TabPracticeLarger").props.disabled).toBe(true);
});

test("larger system text also enlarges score cells and row spacing instead of overlapping strings", async () => {
  const transport = mockTransport();
  await mount(transport);
  const normalHeight = screen!.root
    .findByType(FlatList)
    .props.getItemLayout(null, 0).length;
  const normalScale =
    screen!.root.findAllByType(TablatureBar)[0].props.readingScale;
  jest
    .mocked(useWindowDimensions)
    .mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 2 });
  await update(transport);
  const enlargedHeight = screen!.root
    .findByType(FlatList)
    .props.getItemLayout(null, 0).length;
  const bar = screen!.root.findAllByType(TablatureBar)[0];
  expect(enlargedHeight).toBeGreaterThan(normalHeight * 1.8);
  expect(bar.props.readingScale).toBe(normalScale * 2);
  // The score's geometry includes system scaling, so its text must not scale twice.
  expect(
    bar.findAll(
      (node) =>
        typeof node.type === "string" && node.props.allowFontScaling === false
    ).length
  ).toBeGreaterThan(0);
});

test("count-in beat boxes leave room for enlarged system text", async () => {
  jest
    .mocked(useWindowDimensions)
    .mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 2 });
  await mount(
    mockTransport({
      status: "countingIn",
      countIn: { bar: 1, bars: 1, beat: 1, target: "play" }
    })
  );
  const beat = screen!.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.testID === "practice-count-beat-1"
  )[0];
  expect(StyleSheet.flatten(beat.props.style).height).toBeGreaterThanOrEqual(
    56
  );
});

test("dense passages retain every note as readonly text without insertion cells", async () => {
  const notes = Array.from({ length: 32 }, (_, index) => ({
    string: index % 6,
    fret: index % 25,
    tick: index * 3,
    duration: 3
  }));
  const transport = mockTransport({ tab: { ...example, barCount: 1, notes } });
  await mount(transport);
  const bar = screen!.root.findAllByType(TablatureBar)[0];
  const noteLabels = bar.findAll(
    (node) =>
      typeof node.type === "string" &&
      typeof node.props.accessibilityLabel === "string" &&
      node.props.accessibilityLabel.startsWith("TabNoteDescription")
  );
  expect(noteLabels).toHaveLength(32);
  expect(
    noteLabels.every((note) => note.props.accessibilityRole === "button")
  ).toBe(true);
  await act(async () => bar.props.onSeek(0));
  expect(transport.seek).toHaveBeenCalled();
  expect(transport.setTab).not.toHaveBeenCalled();
});
