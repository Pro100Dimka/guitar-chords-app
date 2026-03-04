// src/screens/tuner/components/strings/index.tsx
import { FC, memo } from "react";
import { useWindowDimensions } from "react-native";
import {
  Group,
  RoundedRect,
  Paragraph,
  Skia
} from "@shopify/react-native-skia";
import Colors from "../../colors";
import { useParagraphBuilder } from "../../paragraphs";
import palette from "@/theme/palette";
import { IStringsProps } from "@/@interfaces";
import { TRANSLATE_Y_GAUGE } from "../gauge-with-note/gauge";
import StringWithVibration from "./string-vibration";

const { primary } = Colors;

export const STRINGS_TOP = 60;
export const NOTE_BOX_TOP = STRINGS_TOP - 55;
export const NOTE_BOX_WIDTH = 50;
export const TRANSLATE_Y_STRINGS = TRANSLATE_Y_GAUGE + 10;
const Strings: FC<IStringsProps> = (props) => {
  const { currentString, volume, stringNotes, gaugeColor } = props;
  const { width, height } = useWindowDimensions();
  const { centered } = useParagraphBuilder();
  const bottom = height / 1.5;
  const spacing = width / (stringNotes.length + 1);
  return (
    <Group transform={[{ translateY: TRANSLATE_Y_STRINGS }]}>
      {stringNotes.map((s, i) => {
        const x = spacing * (i + 1);
        const path = Skia.Path.Make();
        path.moveTo(x, STRINGS_TOP);
        path.lineTo(x, bottom);
        const active =
          s.name === currentString?.note?.name &&
          s.octave === currentString?.note?.octave;
        return (
          <Group key={i}>
            <StringWithVibration
              x={x}
              top={STRINGS_TOP}
              bottom={bottom}
              thickness={s.thickness || 1}
              baseColor={s.baseColor || [0, 0, 0]}
              active={active}
              volume={volume}
            />

            <RoundedRect
              x={x - 25}
              y={NOTE_BOX_TOP}
              width={NOTE_BOX_WIDTH}
              height={50}
              r={10}
              color={
                active
                  ? gaugeColor !== "#7a7a7a"
                    ? gaugeColor
                    : palette.colors.grayOpacity
                  : palette.colors.blackOpacityTiny
              }
            />
            <RoundedRect
              x={x - 25}
              y={NOTE_BOX_TOP}
              width={NOTE_BOX_WIDTH}
              height={50}
              r={10}
              style="stroke"
              strokeWidth={2}
              color={
                active
                  ? gaugeColor !== "#7a7a7a"
                    ? gaugeColor
                    : palette.colors.accent
                  : Colors.secondary
              }
            />
            <Paragraph
              x={x - 25}
              y={NOTE_BOX_TOP + 5}
              width={NOTE_BOX_WIDTH}
              paragraph={centered(s.name, 18, 700, primary)}
            />

            <Paragraph
              x={x - 25}
              y={NOTE_BOX_TOP + 30}
              width={NOTE_BOX_WIDTH}
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

export default memo(Strings, (prev, next) => {
  return (
    JSON.stringify(prev.currentString) === JSON.stringify(next.currentString) &&
    Math.abs(prev.volume - next.volume) < 0.01 &&
    prev.gaugeColor === next.gaugeColor
  );
});
