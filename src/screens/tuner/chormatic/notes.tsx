import React, { FC } from "react";
import { Group, Text, useFont } from "@shopify/react-native-skia";
import fontFamilies from "../../../../assets/fonts/index";

interface IMainNote {
  centerX: number;
  centerY: number;
  maxRadius: number;
  center: { x: number; y: number };
}
const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const Notes: FC<IMainNote> = (props) => {
  const { centerX, centerY, maxRadius, center } = props;
  const fontNote = useFont(fontFamilies.Roboto[2], 18);
  if (!fontNote) return null;
  return (
    <Group>
      {notes.map((note, idx) => {
        const angle = (idx / notes.length) * 2 * Math.PI;
        const x = centerX - 8 + (maxRadius + 15) * Math.cos(angle);
        const y = centerY + 5 + (maxRadius + 15) * Math.sin(angle);
        return (
          <Text
            key={`note-${idx}`}
            x={x}
            y={y}
            text={note}
            font={fontNote}
            color="#fff"
          />
        );
      })}
    </Group>
  );
};
export default Notes;
