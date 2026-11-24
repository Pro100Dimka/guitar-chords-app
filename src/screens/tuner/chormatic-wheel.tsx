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
  const panelWidth = landscape ? Math.max(120, width * 0.4 - 66) : width - 32;
  const columns = panelWidth < 260 ? 6 : 12;
  const panelHeight = columns === 6 ? 80 : 48;
  const diameter = Math.max(
    80,
    Math.min(
      landscape ? width * 0.52 : width - 40,
      height - (landscape ? 40 : columns === 6 ? 236 : 204)
    )
  );
  const hole = {
    x: landscape ? (width * 0.58 - diameter) / 2 : (width - diameter) / 2,
    y: landscape
      ? (height - diameter) / 2
      : Math.max(64, (height - 160 - diameter) / 2),
    width: diameter,
    height: diameter
  };
  const panelLeft = landscape ? width * 0.59 : 16;
  const panelTop = landscape
    ? (height - panelHeight - 76) / 2
    : hole.y + diameter + 22;
  return {
    hole,
    panelWidth,
    panelHeight,
    panelLeft,
    panelTop,
    columns,
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
              y={8 + Math.floor(index / layout.columns) * 32}
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
