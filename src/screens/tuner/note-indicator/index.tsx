import { Group } from "@shopify/react-native-skia";
import { FC, useState } from "react";
import { SharedValue, useAnimatedReaction } from "react-native-reanimated";
import { runOnJS } from "react-native-worklets";
import CurrentNote from "./current-note";
import { INote, IString } from "@/@interfaces";

const NoteIndicator: FC<{
  note: SharedValue<INote | null>;
  fill: SharedValue<number>;
  currString: IString | null;
  width: number;
  height: number;
  availableHeight?: number;
  onReady?: () => void;
}> = ({ note, fill, currString, width, height, availableHeight, onReady }) => {
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
  return (
    <Group>
      <CurrentNote
        fill={fill}
        width={width}
        height={height}
        availableHeight={availableHeight}
        onReady={onReady}
        {...(currentNote ?? {
          name: "",
          pitch: 0,
          refFreq: 0,
          octave: 0,
          direction: "="
        })}
        name={currString?.name || currentNote?.name || ""}
      />
    </Group>
  );
};
export default NoteIndicator;
