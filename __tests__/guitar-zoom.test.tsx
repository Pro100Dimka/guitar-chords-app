import React, { useState } from "react";
import Renderer, { act } from "react-test-renderer";
import { View } from "react-native";
import { GuitarZoom } from "../src/screens/play/guitar-zoom";
import {
  guitarLayout,
  guitarStringSpan
} from "../src/screens/tuner/guitar-layout";

jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: String }) }));

test.each([
  [240, 960],
  [280, 820],
  [289, 975],
  [320, 560],
  [390, 640],
  [568, 220],
  [844, 300],
  [900, 255]
])(
  "zoom keeps all six strings reachable on a %s × %s stage",
  (width, height) => {
    const base = guitarLayout(width, height, 1);
    for (const requested of [0.75, 1, 1.5, 99, Number.NaN]) {
      const frame = guitarLayout(width, height, requested);
      expect(frame.stringLeft).toBeGreaterThanOrEqual(25.99);
      expect(frame.stringLeft + frame.stringWidth).toBeLessThanOrEqual(
        width - 25.99
      );
      expect(frame.stringBottom).toBeGreaterThan(65);
      expect(frame.zoom).toBeGreaterThanOrEqual(0.75);
      expect(frame.zoom).toBeLessThanOrEqual(frame.maximumZoom);
      const scale = frame.artwork.width / base.artwork.width;
      expect(frame.artwork.height / base.artwork.height).toBeCloseTo(scale);
      expect(frame.stringWidth / base.stringWidth).toBeCloseTo(scale);
      expect(frame.hole.width / base.hole.width).toBeCloseTo(scale);
      expect(frame.hole.height / base.hole.height).toBeCloseTo(scale);
      for (let string = 0; string < 6; string++) {
        const x = frame.stringLeft + (frame.stringWidth / 5) * string;
        expect(
          Math.round((x - frame.stringLeft) / (frame.stringWidth / 5))
        ).toBe(string);
      }
    }
  }
);

test("omitting zoom retains the tuner frame and the fitted default stays at 100%", () => {
  const frame = guitarLayout(390, 640);
  expect(frame.artwork.width).toBe(390);
  expect(frame.artwork.height).toBeCloseTo((1846 * 390) / 852);
  expect(frame.stringLeft).toBeCloseTo((197 * 390) / 852);
  expect(frame.stringWidth).toBeCloseTo((456 * 390) / 852);
  expect(guitarLayout(390, 640, 1)).toEqual(frame);
  expect(guitarLayout(240, 960, 1).zoom).toBe(1);
  expect(guitarLayout(289, 975, 1).zoom).toBe(1);
});

let screen: Renderer.ReactTestRenderer | undefined;
afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
});

test("drag previews quantized values and commits once on release; accessibility and reset commit too", async () => {
  const committed = jest.fn();
  const interaction = jest.fn();
  function Harness() {
    const [value, setValue] = useState(1);
    return (
      <GuitarZoom
        value={value}
        maximum={1.5}
        onChange={setValue}
        onCommit={committed}
        onInteractionChange={interaction}
      />
    );
  }
  await act(async () => {
    screen = Renderer.create(<Harness />);
  });
  const slider = () =>
    screen!.root
      .findAllByType(View)
      .find((node) => node.props.accessibilityRole === "adjustable")!;
  await act(async () =>
    slider().props.onLayout({ nativeEvent: { layout: { width: 200 } } })
  );
  const event = (x: number) => ({ nativeEvent: { locationX: x } });
  await act(async () => slider().props.onResponderGrant(event(14)));
  await act(async () => slider().props.onResponderMove(event(100)));
  await act(async () => slider().props.onResponderMove(event(186)));
  expect(slider().props.accessibilityValue.now).toBe(150);
  expect(committed).not.toHaveBeenCalled();
  expect(interaction).toHaveBeenCalledWith(true);
  await act(async () => slider().props.onResponderRelease(event(186)));
  expect(committed).toHaveBeenCalledTimes(1);
  expect(committed).toHaveBeenLastCalledWith(1.5);
  expect(interaction).toHaveBeenLastCalledWith(false);
  await act(async () =>
    slider().props.onAccessibilityAction({
      nativeEvent: { actionName: "decrement" }
    })
  );
  expect(slider().props.accessibilityValue.now).toBe(145);
  expect(committed).toHaveBeenLastCalledWith(1.45);
  await act(async () =>
    screen!.root
      .findAll(
        (node) =>
          node.props.accessibilityLabel === "GuitarZoomReset" &&
          typeof node.props.onPress === "function"
      )[0]
      .props.onPress()
  );
  expect(slider().props.accessibilityValue.now).toBe(100);
  expect(committed).toHaveBeenLastCalledWith(1);
});

test("an interrupted slider gesture settles once and ignores later move events", async () => {
  const changed = jest.fn();
  const committed = jest.fn();
  const interaction = jest.fn();
  await act(async () => {
    screen = Renderer.create(
      <GuitarZoom
        value={1}
        maximum={1.2}
        onChange={changed}
        onCommit={committed}
        onInteractionChange={interaction}
      />
    );
  });
  const slider = () =>
    screen!.root
      .findAllByType(View)
      .find((node) => node.props.accessibilityRole === "adjustable")!;
  await act(async () =>
    slider().props.onLayout({ nativeEvent: { layout: { width: 200 } } })
  );
  await act(async () =>
    slider().props.onResponderGrant({ nativeEvent: { locationX: 200 } })
  );
  expect(changed).toHaveBeenLastCalledWith(1.2);
  await act(async () => slider().props.onResponderTerminate());
  expect(committed).toHaveBeenCalledTimes(1);
  expect(committed).toHaveBeenCalledWith(1.2);
  expect(interaction).toHaveBeenLastCalledWith(false);
  changed.mockClear();
  await act(async () =>
    slider().props.onResponderMove({ nativeEvent: { locationX: 0 } })
  );
  await act(async () => slider().props.onResponderTerminate());
  expect(changed).not.toHaveBeenCalled();
  expect(committed).toHaveBeenCalledTimes(1);
});

test("unmounting a dragging control during rotation releases the play input lock", async () => {
  const committed = jest.fn();
  const interaction = jest.fn();
  await act(async () => {
    screen = Renderer.create(
      <GuitarZoom
        value={1}
        maximum={1.5}
        onChange={() => {}}
        onCommit={committed}
        onInteractionChange={interaction}
      />
    );
  });
  const slider = () =>
    screen!.root
      .findAllByType(View)
      .find((node) => node.props.accessibilityRole === "adjustable")!;
  await act(async () =>
    slider().props.onLayout({ nativeEvent: { layout: { width: 200 } } })
  );
  await act(async () =>
    slider().props.onResponderGrant({ nativeEvent: { locationX: 186 } })
  );
  expect(interaction).toHaveBeenLastCalledWith(true);
  expect(committed).not.toHaveBeenCalled();
  await act(async () => screen!.unmount());
  screen = undefined;
  expect(interaction).toHaveBeenLastCalledWith(false);
  expect(committed).toHaveBeenCalledTimes(1);
  expect(committed).toHaveBeenCalledWith(1.5);
});

test.each([
  [390, 640],
  [240, 960],
  [844, 300],
  [900, 255]
])("complete guitar fits at minimum zoom on %s x %s", (width, height) => {
  const frame = guitarLayout(width, height, 0.25, true);
  expect(frame.artwork.left).toBeGreaterThanOrEqual(0);
  expect(frame.artwork.top).toBeGreaterThanOrEqual(0);
  expect(frame.artwork.left + frame.artwork.width).toBeLessThanOrEqual(width);
  expect(frame.artwork.top + frame.artwork.height).toBeLessThanOrEqual(height);
  expect(guitarStringSpan(frame, frame.stringTop)).toEqual({
    left: frame.stringTopLeft,
    width: frame.stringTopWidth
  });
  expect(guitarStringSpan(frame, frame.stringBottom)).toEqual({
    left: frame.stringLeft,
    width: frame.stringWidth
  });
  expect(
    guitarStringSpan(frame, (frame.stringTop + frame.stringBottom) / 2).width
  ).toBeCloseTo((frame.stringWidth + frame.stringTopWidth) / 2);
});
