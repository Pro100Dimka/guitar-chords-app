import { SharedValue, useDerivedValue } from "react-native-reanimated";
import React, { FC, useEffect } from "react";
import {
  Oval,
  Paragraph,
  Group,
  Skia,
  TextAlign
} from "@shopify/react-native-skia";
import palette from "@/theme/palette";
import { useParagraphBuilder } from "../paragraphs";
import { INote } from "@/@interfaces";
import NotePitch from "./note-pitch";

const CurrentNote: FC<
  INote & {
    width: number;
    height: number;
    fill: SharedValue<number>;
    availableHeight?: number;
    onReady?: () => void;
  }
> = ({
  fill,
  name,
  pitch,
  refFreq,
  octave,
  width,
  height,
  availableHeight,
  onReady
}) => {
  const { centered, fonts } = useParagraphBuilder();
  useEffect(() => {
    if (fonts) onReady?.();
  }, [fonts, onReady]);
  const colors = palette.guitarDial;
  // Inner rim measured in the 1024 x 1536 artwork; the fretboard covers its top.
  const hole = {
    x: (width * 244) / 1024,
    y: (height * 275) / 1536,
    width: (width * 548) / 1024,
    height: (height * 500) / 1536
  };
  const centerX = hole.x + hole.width / 2;
  const contentHeight = Math.min(hole.height, availableHeight ?? hole.height);
  const content = {
    ...hole,
    y: hole.y + (hole.height - contentHeight) / 2,
    height: contentHeight
  };
  const scale = Math.min(hole.width / 220, content.height / 174);
  const voiced =
    Number.isFinite(pitch) &&
    pitch > 0 &&
    Number.isFinite(refFreq) &&
    refFreq > 0;
  const cents = voiced ? 1200 * Math.log2(pitch / refFreq) : null;
  const noteText =
    fonts &&
    Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center }, fonts)
      .pushStyle({
        fontFamilies: ["Roboto"],
        fontSize: 64 * scale,
        fontStyle: { weight: 500 },
        color: Skia.Color(colors.note)
      })
      .addText(voiced ? name : "·")
      .pushStyle({ fontSize: 23 * scale, color: Skia.Color(colors.engraving) })
      .addText(voiced ? String(octave) : "")
      .build();
  const greenClip = useDerivedValue(() => ({
    x: hole.x,
    y: Math.max((height * 304) / 1536, hole.y + hole.height * (1 - fill.value)),
    width: hole.width,
    height: hole.height * fill.value
  }));
  return (
    <Group>
      <Group clip={{ x: 0, y: (height * 304) / 1536, width, height }}>
        <Oval {...hole} color={colors.center} />
      </Group>
      <Group clip={greenClip}>
        <Oval {...hole} color={colors.tuned} opacity={0.24} />
      </Group>
      <Paragraph
        x={hole.x}
        y={content.y + content.height * 0.25}
        width={hole.width}
        paragraph={noteText}
      />
      <Group
        transform={[
          { translateX: centerX },
          { translateY: content.y + content.height * 0.73 }
        ]}
      >
        <NotePitch pitch={pitch} refFreq={refFreq} width={hole.width * 0.58} />
      </Group>
      <Paragraph
        x={hole.x}
        y={content.y + content.height * 0.81}
        width={hole.width}
        paragraph={centered(
          voiced ? `${pitch.toFixed(1)} Hz` : "·",
          Math.max(11, 12 * scale),
          500,
          cents !== null && Math.abs(cents) <= 5
            ? colors.tuned
            : colors.engraving
        )}
      />
    </Group>
  );
};
export default CurrentNote;
