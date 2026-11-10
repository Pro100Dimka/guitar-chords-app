import { Group } from "@shopify/react-native-skia";
import { FC, useState } from "react";
import { SharedValue, useAnimatedReaction } from "react-native-reanimated";
import { runOnJS } from "react-native-worklets";
import CurrentNote from "./current-note";
import { INote, IString } from "@/@interfaces";

const NoteIndicator: FC<{
  note: SharedValue<INote | null>;
  currString: IString | null;
  width: number;
  height: number;
}> = ({ note, currString, width, height }) => {
  const [currentNote, setCurrentNote] = useState<INote | null>(null);
  useAnimatedReaction(
    () => note.value,
    (next, previous) => {
      if (
        next?.name !== previous?.name ||
        next?.pitch !== previous?.pitch ||
        next?.refFreq !== previous?.refFreq ||
        next?.octave !== previous?.octave
      ) {
        runOnJS(setCurrentNote)(next);
      }
    }
  );
  if (!currentNote) return null;
  return (
    <Group>
      <CurrentNote
        width={width}
        height={height}
        {...{ ...currentNote, name: currString?.name || currentNote.name }}
      />
    </Group>
  );
};
export default NoteIndicator;
