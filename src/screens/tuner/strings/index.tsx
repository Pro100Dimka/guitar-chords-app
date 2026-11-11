// src/screens/tuner/components/strings/index.tsx
import { FC, useState } from "react";
import {
  Group,
  RoundedRect,
  Paragraph,
  Skia
} from "@shopify/react-native-skia";
import palette from "../../../theme/palette";
import StringWithVibration from "./string-vibration";
import {
  SharedValue,
  useAnimatedReaction,
  useDerivedValue
} from "react-native-reanimated";
import { runOnJS } from "react-native-worklets";
import { useParagraphBuilder } from "../paragraphs";
import { INote, IString } from "@/@interfaces";

const primary = palette.guitarDial.note;

export const STRINGS_TOP = 0;
export const NOTE_BOX_TOP = STRINGS_TOP - 55;
export const NOTE_BOX_WIDTH = 50;
export const TRANSLATE_Y_STRINGS = 70;
// Bridge pins stay attached to the stretched guitar artwork.
export const BRIDGE_Y_RATIO = 0.92;
// The extended artwork adds 680 pixels above the original 1536-pixel body.
export const NECK_EXTENSION_RATIO = 680 / 2216;

const Strings: FC<{
  rms: SharedValue<number>;
  note: SharedValue<INote | null>;
  fill: SharedValue<number>;
  fillKey: SharedValue<string>;
  stringNotes: IString[] | null;
  currString: IString | null;
  width: number;
  height: number;
  neckHeight?: number;
}> = (props) => {
  const {
    note,
    fill,
    fillKey,
    rms,
    stringNotes,
    currString,
    width,
    height,
    neckHeight = 0
  } = props;
  const [currentNote, setCurrentNote] = useState<INote | null>(null);
  const { centered } = useParagraphBuilder();
  useAnimatedReaction(
    () => note.value,
    (next, previous) => {
      if (next?.name !== previous?.name || next?.octave !== previous?.octave) {
        runOnJS(setCurrentNote)(next);
      }
    }
  );
  if (!stringNotes) return null;
  const bottom = Math.max(20, height * BRIDGE_Y_RATIO - TRANSLATE_Y_STRINGS);
  const spacing = width / (stringNotes.length + 1);
  const boxWidth = Math.min(NOTE_BOX_WIDTH, spacing - 4);
  const top = -neckHeight - TRANSLATE_Y_STRINGS;
  const boxTop = NOTE_BOX_TOP - neckHeight;
  const stringClip = Skia.Path.Make();
  stringClip.addRect({ x: 0, y: top, width, height: boxTop - top });
  stringClip.addRect({
    x: 0,
    y: boxTop + 50,
    width,
    height: bottom - boxTop - 50 + 12
  });
  return (
    <Group transform={[{ translateY: TRANSLATE_Y_STRINGS }]}>
      {stringNotes.map((s, i) => {
        const x = spacing * (i + 1);
        const curr = currString || currentNote;
        const active = s.name === curr?.name && s.octave === curr?.octave;
        return (
          <Group key={i}>
            <Group clip={stringClip}>
              <StringWithVibration
                x={x}
                top={top}
                bottom={bottom}
                thickness={s.thickness || 1}
                baseColor={s.baseColor || [0, 0, 0]}
                active={active}
                volume={rms}
              />
            </Group>

            <RoundedRect
              x={x - boxWidth / 2}
              y={boxTop}
              width={boxWidth}
              height={50}
              r={10}
              color={
                active
                  ? palette.colors.grayOpacity
                  : palette.colors.blackOpacityTiny
              }
            />
            <RoundedRect
              x={x - boxWidth / 2}
              y={boxTop}
              width={boxWidth}
              height={50}
              r={10}
              style="stroke"
              strokeWidth={1}
              color={
                active ? palette.chromatic.brass : palette.chromatic.border
              }
            />
            <StringFill
              x={x - boxWidth / 2}
              y={boxTop}
              width={boxWidth}
              noteKey={`${s.name}${s.octave}`}
              fill={fill}
              fillKey={fillKey}
            />
            <Paragraph
              x={x - boxWidth / 2}
              y={boxTop + 5}
              width={boxWidth}
              paragraph={centered(s.name, 18, 600, primary)}
            />

            <Paragraph
              x={x - boxWidth / 2}
              y={boxTop + 30}
              width={boxWidth}
              paragraph={centered(
                `${stringNotes.length - i}`,
                14,
                500,
                primary
              )}
            />
          </Group>
        );
      })}
    </Group>
  );
};

function StringFill({
  x,
  y,
  width,
  noteKey,
  fill,
  fillKey
}: {
  x: number;
  y: number;
  width: number;
  noteKey: string;
  fill: SharedValue<number>;
  fillKey: SharedValue<string>;
}) {
  const clip = useDerivedValue(() => {
    const progress = fillKey.value === noteKey ? fill.value : 0;
    return { x, y: y + 50 * (1 - progress), width, height: 50 * progress };
  });
  return (
    <Group clip={clip}>
      <RoundedRect
        x={x}
        y={y}
        width={width}
        height={50}
        r={10}
        color={palette.guitarDial.tuned}
        opacity={0.78}
      />
    </Group>
  );
}
export default Strings;
