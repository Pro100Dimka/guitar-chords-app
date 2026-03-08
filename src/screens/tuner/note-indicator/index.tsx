import { Group } from "@shopify/react-native-skia";
import { FC, useState } from "react";
import { SharedValue, useDerivedValue } from "react-native-reanimated";
import { runOnJS } from "react-native-worklets";
import NotePitch from "./note-pitch";
import CurrentNote from "./current-note";
import { INote, IString } from "@/@interfaces";

const NoteIndicator: FC<{
  note: SharedValue<INote | null>;
  currString: IString | null;
}> = ({ note, currString }) => {
  const [currentNote, setCurrentNote] = useState<INote | null>(null);
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
  });
  if (!currentNote) return null;
  return (
    <Group transform={[{ translateY: 15 }]}>
      <CurrentNote
        {...{ ...currentNote, name: currString?.name || currentNote.name }}
      />
      <NotePitch {...currentNote} />
    </Group>
  );
};
export default NoteIndicator;
