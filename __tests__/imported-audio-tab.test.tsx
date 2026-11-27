import React from "react";
import Renderer, { act } from "react-test-renderer";
import { ImportedAudioTab } from "../src/screens/analyze-audio/imported-audio-tab";
import { TablaturePanel } from "../src/screens/play/tablature-panel";
import {
  emptyTablature,
  normalizeTablature
} from "../src/components/tablature";
import { performanceAudio } from "../src/components/performance-audio";
import { warmGuitar } from "../src/components/guitar-audio";
import {
  readTablatureDraft,
  writeTablatureDraft
} from "../src/components/tablature-draft";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}));
jest.mock("../src/screens/song/tools", () => ({
  Action: () => null,
  TempoControl: () => null
}));
jest.mock("../src/screens/play/tablature-panel", () => ({
  TablaturePanel: () => null
}));
jest.mock("../src/components/tablature-draft", () => ({
  readTablatureDraft: jest.fn(),
  writeTablatureDraft: jest.fn()
}));
jest.mock("../src/components/guitar-audio", () => ({
  ...jest.requireActual("../src/components/guitar-audio"),
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

let screen: Renderer.ReactTestRenderer | undefined;
const initial = normalizeTablature({
  ...emptyTablature(120),
  version: 3,
  notes: [{ string: 0, fret: 0, tick: 0, duration: 24, velocity: 96 }]
})!;
const panel = () => screen!.root.findByType(TablaturePanel).props;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(warmGuitar).mockResolvedValue(undefined);
});
afterEach(async () => {
  if (screen) await act(async () => screen?.unmount());
  screen = undefined;
  jest.useRealTimers();
});

test("closing and reopening the isolated editor retains edits without accessing Play's draft", async () => {
  const onChange = jest.fn();
  const onSave = jest.fn();
  const onClose = jest.fn();
  const properties = {
    initial,
    title: "Imported audio",
    active: true,
    disabled: false,
    onChange,
    onSave,
    onClose
  };
  await act(async () => {
    screen = Renderer.create(<ImportedAudioTab {...properties} visible />);
  });
  expect(panel().onOpen).toBeUndefined();
  expect(panel().onRecord).toBeUndefined();
  expect(panel().onPractice).toBeUndefined();
  const edited = normalizeTablature({
    ...initial,
    notes: [{ ...initial.notes[0], fret: 3 }]
  })!;
  await act(async () => panel().transport.setTab(edited));
  expect(onChange).toHaveBeenLastCalledWith(edited, true);
  await act(async () => panel().onClose());
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () =>
    screen!.update(<ImportedAudioTab {...properties} visible={false} />)
  );
  expect(screen!.root.findAllByType(TablaturePanel)).toHaveLength(0);
  await act(async () =>
    screen!.update(<ImportedAudioTab {...properties} visible />)
  );
  expect(panel().transport.tab).toEqual(edited);
  expect(panel().dirty).toBe(true);
  await act(async () => panel().onSave());
  expect(onSave).toHaveBeenCalledWith(edited);
  expect(readTablatureDraft).not.toHaveBeenCalled();
  expect(writeTablatureDraft).not.toHaveBeenCalled();
});

test("imported tabs use the real guitar transport and stop when the analysis loses focus", async () => {
  const sequence = normalizeTablature({
    ...initial,
    notes: [
      initial.notes[0],
      // A distinct string attacks at 1 s (48 ticks at 120 BPM), after blur.
      { ...initial.notes[0], string: 1, fret: 2, tick: 48 }
    ]
  })!;
  const properties = {
    initial: sequence,
    title: "Imported audio",
    visible: true,
    disabled: false,
    onChange: jest.fn(),
    onSave: jest.fn(),
    onClose: jest.fn()
  };
  await act(async () => {
    screen = Renderer.create(<ImportedAudioTab {...properties} active />);
  });
  await act(async () => panel().transport.play());
  expect(warmGuitar).toHaveBeenCalled();
  const getPosition = panel().transport.positionSource.getSnapshot;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(250);
  });
  expect(performanceAudio.guitarString).toHaveBeenCalledTimes(1);
  expect(getPosition()).toBeGreaterThan(0);
  expect(panel().transport.status).toBe("playing");
  const attacksBeforeBlur = jest
    .mocked(performanceAudio.guitarString)
    .mock.calls.slice();
  jest.mocked(performanceAudio.stopGuitarString).mockClear();
  await act(async () =>
    screen!.update(<ImportedAudioTab {...properties} active={false} />)
  );
  expect(performanceAudio.stopGuitarString).toHaveBeenCalledWith(0);
  const pausedPosition = getPosition();
  // Async act also queues React bookkeeping microtasks that fake timers count.
  // Cross the future note's onset and release without clearing any timers.
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1500);
  });
  expect(jest.mocked(performanceAudio.guitarString).mock.calls).toEqual(
    attacksBeforeBlur
  );
  expect(getPosition()).toBe(pausedPosition);
  await act(async () =>
    screen!.update(<ImportedAudioTab {...properties} active />)
  );
  expect(panel().transport.status).toBe("idle");
  expect(panel().transport.tick).toBe(pausedPosition);
  expect(panel().transport.tab).toEqual(sequence);
  expect(jest.mocked(performanceAudio.guitarString).mock.calls).toEqual(
    attacksBeforeBlur
  );
  expect(writeTablatureDraft).not.toHaveBeenCalled();
});
