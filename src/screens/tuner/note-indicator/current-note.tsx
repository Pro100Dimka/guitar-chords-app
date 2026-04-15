// src/tuner/note-indicator/current-note.tsx
import React, { FC } from "react";
import { Dimensions } from "react-native";
import { RoundedRect, Paragraph, Group } from "@shopify/react-native-skia";
import palette from "@/theme/palette";
import { useParagraphBuilder } from "../paragraphs";
import { INote, ITextItem } from "@/@interfaces";
import { ParagraphProps } from "@/@types";
import { getNoteColor } from "./note-pitch";

export const noteBox = { width: 225, height: 250 };

const CurrentNote: FC<INote> = (currentNote) => {
  const { width } = Dimensions.get("window");
  const centerX = width / 2 - noteBox.width / 2;
  const { centered } = useParagraphBuilder();
  const getParagraphs = (): ITextItem[] => {
    if (!currentNote) return [];
    const { name, pitch, refFreq, octave } = currentNote;
    const diff = refFreq ? Math.abs(pitch - refFreq).toFixed(1) + "Hz" : null;
    const gaugeColor = getNoteColor(pitch, refFreq) || palette.colors.white;
    const items: ParagraphProps[] = [
      [
        [name === "Silence" ? "-" : name, 70, 600, gaugeColor],
        [centerX, centerX, noteBox.width]
      ],
      [
        [`${octave || ""}`, 24, 600, gaugeColor],
        [centerX + 42, centerX + 135, 20]
      ],
      refFreq && [
        [diff, 20, 500, gaugeColor],
        [centerX + 72, centerX, noteBox.width]
      ]
    ].filter(Boolean) as ParagraphProps[];
    return items.map(([p, [y, x = centerX, w = noteBox.width]]) => ({
      p,
      y,
      x,
      w
    }));
  };

  return (
    <Group transform={[{ translateY: 7 }]}>
      <RoundedRect
        x={centerX}
        y={0}
        width={noteBox.width}
        height={noteBox.height}
        r={115}
        color={palette.colors.blackOpacity}
      />
      {getParagraphs().map(({ p, y, x = centerX, w = noteBox.width }, i) => (
        <Paragraph key={i} x={x} y={y} width={w} paragraph={centered(...p)} />
      ))}
    </Group>
  );
};

export default CurrentNote;
