// src/screens/tuner/components/strings/index.tsx
import { FC, useState } from "react";
import { Dimensions } from "react-native";
import {
  Group,
  RoundedRect,
  Paragraph,
  Skia
} from "@shopify/react-native-skia";
import palette from "../../../theme/palette";
import StringWithVibration from "./string-vibration";
import { TRANSLATE_Y_GAUGE } from "../note-indicator/note-pitch";
import { SharedValue, useDerivedValue } from "react-native-reanimated";
import { runOnJS } from "react-native-worklets";
import { useParagraphBuilder } from "../paragraphs";
import { INote, IString } from "@/@interfaces";

const { primary } = palette.colors;

export const STRINGS_TOP = 60;
export const NOTE_BOX_TOP = STRINGS_TOP - 55;
export const NOTE_BOX_WIDTH = 50;
export const TRANSLATE_Y_STRINGS = TRANSLATE_Y_GAUGE + 30;

const Strings: FC<{
  rms: SharedValue<number>;
  note: SharedValue<INote | null>;
  stringNotes: IString[] | null;
  currString: IString | null;
}> = (props) => {
  const { note, rms, stringNotes, currString } = props;
  const { width, height } = Dimensions.get("window");
  const [currentNote, setCurrentNote] = useState<INote | null>(null);
  const { centered } = useParagraphBuilder();
  const [volume, setVolume] = useState(0);
  useDerivedValue(() => {
    const newNote = note.value as INote;
    if (
      !currentNote ||
      newNote.name !== currentNote.name ||
      newNote.pitch !== currentNote.pitch ||
      newNote.refFreq !== currentNote.refFreq ||
      newNote.direction !== currentNote.direction
    ) {
      runOnJS(setCurrentNote)(newNote);
    }
    if (volume !== rms.value) runOnJS(setVolume)(rms.value);
  });
  if (!stringNotes) return null;
  const bottom = height / 1.7;
  const spacing = width / (stringNotes.length + 1);
  return (
    <Group transform={[{ translateY: TRANSLATE_Y_STRINGS }]}>
      {stringNotes.map((s, i) => {
        const x = spacing * (i + 1);
        const path = Skia.Path.Make();
        path.moveTo(x, STRINGS_TOP);
        path.lineTo(x, bottom);
        const curr = currString || currentNote;
        const active = s.name === curr?.name && s.octave === curr?.octave;
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
                  ? palette.colors.grayOpacity
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
              color={active ? palette.colors.accent : palette.colors.secondary}
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

export default Strings;
