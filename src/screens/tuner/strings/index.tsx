// src/screens/tuner/components/strings/index.tsx
import { FC, memo, useEffect, useMemo, useState } from "react";
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
  cancelAnimation,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming
} from "react-native-reanimated";
import { runOnJS } from "react-native-worklets";
import { useParagraphBuilder } from "../paragraphs";
import { INote, IString } from "@/@interfaces";
import { guitarLayout, guitarStringSpan } from "../guitar-layout";

const primary = palette.guitarDial.note;

export const NOTE_BOX_WIDTH = 50;

const Strings: FC<{
  rms: SharedValue<number>;
  plucks: SharedValue<number[]>;
  note: SharedValue<INote | null>;
  fill: SharedValue<number>;
  fillKey: SharedValue<string>;
  stringNotes: IString[] | null;
  currString: IString | null;
  width: number;
  height: number;
  zoom?: number;
  complete?: boolean;
  onReady?: () => void;
}> = (props) => {
  const {
    note,
    fill,
    fillKey,
    rms,
    plucks,
    stringNotes,
    currString,
    width,
    height,
    zoom,
    complete = false,
    onReady
  } = props;
  const [currentNote, setCurrentNote] = useState<INote | null>(null);
  const microphoneGain = useSharedValue(1);
  useAnimatedReaction(
    () => plucks.value,
    (next, previous) => {
      if (!next.length) {
        microphoneGain.value = 1;
        return;
      }
      if (!next.some((count, index) => count > (previous?.[index] ?? 0)))
        return;
      microphoneGain.value = 0;
      microphoneGain.value = withDelay(3100, withTiming(1, { duration: 100 }));
    }
  );
  const stringVolume = useDerivedValue(() => rms.value * microphoneGain.value);
  useEffect(() => () => cancelAnimation(microphoneGain), [microphoneGain]);
  const { centered, fonts } = useParagraphBuilder();
  const labels = useMemo(
    () =>
      stringNotes?.map((string, index) => ({
        name: centered(string.name, 18, 600, primary),
        number: centered(String(stringNotes.length - index), 14, 500, primary)
      })),
    [centered, stringNotes]
  );
  useEffect(() => {
    if (fonts && stringNotes?.length) onReady?.();
  }, [fonts, stringNotes, onReady]);
  useAnimatedReaction(
    () => note.value,
    (next, previous) => {
      if (next?.name !== previous?.name || next?.octave !== previous?.octave) {
        runOnJS(setCurrentNote)(next);
      }
    }
  );
  if (!stringNotes) return null;
  const frame = guitarLayout(width, height, zoom, complete);
  const {
    stringLeft,
    stringWidth,
    stringBottom: bottom,
    stringTop: nutY,
    stringTopLeft,
    stringTopWidth
  } = frame;
  const spacing = stringWidth / Math.max(1, stringNotes.length - 1);
  const top = 0;
  const boxTop = complete ? Math.max(15, nutY + 8) : 15;
  const labelSpan = guitarStringSpan(frame, boxTop);
  const showLabels = !complete || labelSpan.width >= 150;
  const boxWidth = Math.min(NOTE_BOX_WIDTH, labelSpan.width / 5 - 4);
  const stringClip = Skia.Path.Make();
  stringClip.addRect({
    x: 0,
    y: top,
    width,
    height: showLabels ? boxTop - top : height
  });
  stringClip.addRect({
    x: 0,
    y: boxTop + 50,
    width,
    height: Math.max(0, bottom - boxTop - 50 + 12)
  });
  return (
    <Group>
      {stringNotes.map((s, i) => {
        const x = stringLeft + spacing * i;
        const topX = stringTopLeft + (stringTopWidth / 5) * i;
        const labelX = labelSpan.left + (labelSpan.width / 5) * i;
        const curr = currString || currentNote;
        const active = s.name === curr?.name && s.octave === curr?.octave;
        return (
          <Group key={i}>
            <Group clip={stringClip}>
              <StringWithVibration
                x={x}
                topX={topX}
                top={nutY}
                bottom={bottom}
                thickness={
                  (s.thickness || 1) *
                  (complete ? Math.max(0.3, frame.stringWidth / 267) : 1)
                }
                baseColor={s.baseColor || [0, 0, 0]}
                active={active}
                volume={stringVolume}
                plucks={plucks}
                index={i}
              />
            </Group>

            {showLabels && (
              <Group>
                <RoundedRect
                  x={labelX - boxWidth / 2}
                  y={boxTop}
                  width={boxWidth}
                  height={50}
                  r={10}
                  color={
                    width > height
                      ? palette.glass.surface
                      : active
                        ? palette.colors.grayOpacity
                        : palette.colors.blackOpacityTiny
                  }
                />
                <RoundedRect
                  x={labelX - boxWidth / 2}
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
                  x={labelX - boxWidth / 2}
                  y={boxTop}
                  width={boxWidth}
                  noteKey={`${s.name}${s.octave}`}
                  fill={fill}
                  fillKey={fillKey}
                />
                <Paragraph
                  x={labelX - boxWidth / 2}
                  y={boxTop + 5}
                  width={boxWidth}
                  paragraph={labels?.[i].name ?? null}
                />

                <Paragraph
                  x={labelX - boxWidth / 2}
                  y={boxTop + 30}
                  width={boxWidth}
                  paragraph={labels?.[i].number ?? null}
                />
              </Group>
            )}
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
export default memo(Strings);
