import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BlurMask,
  Circle,
  Group,
  LinearGradient,
  RoundedRect,
  SkFont,
  Text,
  useFont,
  vec
} from "@shopify/react-native-skia";
import { SharedValue, useDerivedValue } from "react-native-reanimated";
import { INote } from "@/@interfaces";
import palette from "@/theme/palette";
import fontFamilies from "../../../assets/fonts";
import CurrentNote from "./note-indicator/current-note";
import { noteNames } from "./tunings";

export function chromaticLayout(width: number, height: number) {
  const landscape = width > height;
  const landscapeDiameter = Math.max(
    80,
    Math.min(width * 0.52, height - 40, 2 * (width * 0.71 - 236))
  );
  // Keep the note panel outside the dial and the right-side audio controls.
  const panelLeft = landscape
    ? (width * 0.58 + landscapeDiameter) / 2 + 20
    : 16;
  const panelWidth = Math.max(16, width - panelLeft - (landscape ? 68 : 16));
  const availableRows = height - (landscape ? 86 : 252);
  // Prefer 44-point touch targets in both dimensions; when the viewport is
  // constrained, choose the grid that maximizes the smaller target dimension.
  let columns = 12;
  let rowHeight = 24;
  let bestTarget = 0;
  for (const count of [12, 6, 4, 3]) {
    const candidateHeight = Math.max(
      24,
      Math.min(44, Math.floor(availableRows / (12 / count)))
    );
    const target = Math.min(44, (panelWidth - 16) / count, candidateHeight);
    if (target > bestTarget) {
      bestTarget = target;
      columns = count;
      rowHeight = candidateHeight;
    }
  }
  const panelHeight = (12 / columns) * rowHeight + 16;
  const diameter = landscape
    ? landscapeDiameter
    : Math.max(80, Math.min(width - 40, height - panelHeight - 156));
  const hole = {
    x: landscape ? (width * 0.58 - diameter) / 2 : (width - diameter) / 2,
    y: landscape
      ? (height - diameter) / 2
      : Math.max(
          64,
          Math.min(
            (height - 160 - diameter) / 2,
            height - diameter - panelHeight - 92
          )
        ),
    width: diameter,
    height: diameter
  };
  const panelTop = landscape
    ? Math.max(0, (height - panelHeight - 62) / 2)
    : hole.y + diameter + 22;
  return {
    hole,
    panelWidth,
    panelHeight,
    panelLeft,
    panelTop,
    columns,
    rowHeight,
    octaveTop: panelTop + panelHeight + 18,
    octaveLeft: panelLeft + panelWidth * 0.15,
    octaveWidth: panelWidth * 0.7
  };
}

function ChromaticWheel({
  note,
  fill,
  rms,
  signal,
  width,
  height,
  onReady
}: {
  note: SharedValue<INote | null>;
  fill: SharedValue<number>;
  rms: SharedValue<number>;
  signal: SharedValue<number[]>;
  width: number;
  height: number;
  onReady?: () => void;
}) {
  const font = useFont(fontFamilies.Manrope[1], 12);
  const [faceReady, setFaceReady] = useState(false);
  const markFaceReady = useCallback(() => setFaceReady(true), []);
  useEffect(() => {
    if (font && faceReady) onReady?.();
  }, [font, faceReady, onReady]);
  const layout = useMemo(() => chromaticLayout(width, height), [width, height]);
  const cx = layout.hole.x + layout.hole.width / 2;
  const cy = layout.hole.y + layout.hole.height / 2;
  const radius = layout.hole.width / 2;
  const spacing = (layout.panelWidth - 16) / layout.columns;
  return (
    <Group>
      <Circle
        cx={cx}
        cy={cy}
        r={radius + 9}
        color={palette.gold.glow}
        opacity={0.12}
      >
        <BlurMask blur={14} />
      </Circle>
      <Circle cx={cx} cy={cy} r={radius + 13} color={palette.glass.control} />
      <Circle
        cx={cx}
        cy={cy}
        r={radius + 10}
        style="stroke"
        strokeWidth={1}
        color={palette.finish.edge}
      />
      <Circle cx={cx} cy={cy} r={radius + 5} style="stroke" strokeWidth={4.5}>
        <LinearGradient
          start={vec(cx - radius, cy - radius)}
          end={vec(cx + radius, cy + radius)}
          colors={[
            palette.glass.control,
            palette.gold.rimLight,
            palette.gold.rimShade,
            palette.paper.soft,
            palette.gold.center,
            palette.gold.rimLight
          ]}
          positions={[0, 0.17, 0.3, 0.58, 0.8, 1]}
        />
      </Circle>
      <Circle
        cx={cx}
        cy={cy}
        r={radius + 1}
        style="stroke"
        strokeWidth={0.8}
        color={palette.gold.rimLight}
        opacity={0.8}
      />
      {[-1, 1].map((side) => (
        <Group key={side}>
          <Circle
            cx={cx + side * (radius + 5) * 0.66}
            cy={cy + side * (radius + 5) * 0.75}
            r={5}
            color={palette.gold.glow}
            opacity={0.36}
          >
            <BlurMask blur={7} />
          </Circle>
          <Circle
            cx={cx + side * (radius + 5) * 0.66}
            cy={cy + side * (radius + 5) * 0.75}
            r={0.9}
            color={palette.gold.rimLight}
          />
        </Group>
      ))}
      <CurrentNote
        note={note}
        fill={fill}
        rms={rms}
        signal={signal}
        width={width}
        height={height}
        face={layout.hole}
        onReady={markFaceReady}
      />
      {font && (
        <Group
          transform={[
            { translateX: layout.panelLeft },
            { translateY: layout.panelTop }
          ]}
        >
          <RoundedRect
            x={0}
            y={0}
            width={layout.panelWidth}
            height={layout.panelHeight}
            r={24}
            color={palette.glass.control}
          >
            <LinearGradient
              start={vec(0, 0)}
              end={vec(0, layout.panelHeight)}
              colors={palette.chromatic.controlFace}
            />
          </RoundedRect>
          <RoundedRect
            x={0}
            y={0}
            width={layout.panelWidth}
            height={layout.panelHeight}
            r={24}
            style="stroke"
            strokeWidth={1}
          >
            <LinearGradient
              start={vec(0, 0)}
              end={vec(layout.panelWidth, layout.panelHeight)}
              colors={[
                palette.glass.edge,
                palette.gold.rimLight,
                palette.glass.control,
                palette.gold.rimShade
              ]}
            />
          </RoundedRect>
          {noteNames.map((name, index) => (
            <PitchName
              key={name}
              note={note}
              name={name}
              font={font}
              x={8 + spacing * (index % layout.columns)}
              y={
                8 +
                Math.floor(index / layout.columns) * layout.rowHeight +
                (layout.rowHeight - 23) / 2
              }
              width={spacing}
            />
          ))}
        </Group>
      )}
    </Group>
  );
}

export default React.memo(ChromaticWheel);

function PitchName({
  note,
  name,
  font,
  x,
  y,
  width
}: {
  note: SharedValue<INote | null>;
  name: string;
  font: SkFont;
  x: number;
  y: number;
  width: number;
}) {
  const active = useDerivedValue(() =>
    note.value?.name === name && (note.value?.pitch ?? 0) > 0 ? 1 : 0
  );
  const color = useDerivedValue(() =>
    active.value ? palette.gold.ink : palette.glass.muted
  );
  const glow = useDerivedValue(() => active.value * 0.36);
  return (
    <Group>
      <RoundedRect
        x={x + 1}
        y={y}
        width={width - 2}
        height={23}
        r={6}
        opacity={glow}
        color={palette.gold.glow}
      >
        <BlurMask blur={5} />
      </RoundedRect>
      <RoundedRect
        x={x + 1}
        y={y}
        width={width - 2}
        height={23}
        r={6}
        opacity={active}
        color={palette.glass.accent}
      >
        <LinearGradient
          start={vec(0, y)}
          end={vec(0, y + 23)}
          colors={palette.finish.goldColors}
          positions={palette.finish.locations}
        />
      </RoundedRect>
      <Text
        x={x + (width - font.getTextWidth(name)) / 2}
        y={y + 16}
        text={name}
        font={font}
        color={color}
      />
    </Group>
  );
}
