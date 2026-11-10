import React, { FC } from "react";
import {
  Oval,
  Paragraph,
  Group,
  RadialGradient,
  Skia,
  TextAlign,
  vec
} from "@shopify/react-native-skia";
import palette from "@/theme/palette";
import { useParagraphBuilder } from "../paragraphs";
import { INote } from "@/@interfaces";
import NotePitch from "./note-pitch";

const CurrentNote: FC<INote & { width: number; height: number }> = ({
  name,
  pitch,
  refFreq,
  octave,
  width,
  height
}) => {
  const { centered, fonts } = useParagraphBuilder();
  const colors = palette.guitarDial;
  // Inner rim measured in the 1024 x 1536 artwork; the fretboard covers its top.
  const hole = {
    x: (width * 244) / 1024,
    y: (height * 275) / 1536,
    width: (width * 548) / 1024,
    height: (height * 500) / 1536
  };
  const centerX = hole.x + hole.width / 2;
  const scale = Math.min(hole.width / 220, hole.height / 174);
  const voiced =
    Number.isFinite(pitch) &&
    pitch > 0 &&
    Number.isFinite(refFreq) &&
    refFreq > 0;
  const cents = voiced ? 1200 * Math.log2(pitch / refFreq) : null;
  const roundedCents = cents === null ? null : Math.round(cents);
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
  return (
    <Group>
      <Group clip={{ x: 0, y: (height * 304) / 1536, width, height }}>
        <Oval {...hole}>
          <RadialGradient
            c={vec(centerX, hole.y + hole.height * 0.4)}
            r={Math.max(hole.width, hole.height) * 0.6}
            colors={[colors.center, colors.edge]}
          />
        </Oval>
      </Group>
      <Paragraph
        x={hole.x}
        y={hole.y + hole.height * 0.12}
        width={hole.width}
        paragraph={centered(
          voiced ? `${pitch.toFixed(1)} Hz` : "A4 · 440 Hz",
          Math.max(10, 11 * scale),
          400,
          colors.engraving
        )}
      />
      <Paragraph
        x={hole.x}
        y={hole.y + hole.height * 0.25}
        width={hole.width}
        paragraph={noteText}
      />
      <Group
        transform={[
          { translateX: centerX },
          { translateY: hole.y + hole.height * 0.73 }
        ]}
      >
        <NotePitch pitch={pitch} refFreq={refFreq} width={hole.width * 0.58} />
      </Group>
      <Paragraph
        x={hole.x}
        y={hole.y + hole.height * 0.81}
        width={hole.width}
        paragraph={centered(
          roundedCents === null
            ? "·"
            : `${roundedCents > 0 ? "+" : ""}${roundedCents} ¢`,
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
