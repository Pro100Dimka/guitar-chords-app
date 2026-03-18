/* eslint-disable react-hooks/exhaustive-deps */
// src/tuner/note-indicator/note-pitch-indicator.tsx
import { Group, Line, Circle, Paint } from "@shopify/react-native-skia";
import React, { FC, useEffect } from "react";
import { useSharedValue, withSpring } from "react-native-reanimated";
import palette from "@/theme/palette";
import { Dimensions } from "react-native";

export const TRANSLATE_Y_GAUGE = 90 + 32; // высота блока ноты + отступ
const GAUGE_WIDTH = 350; // ширина шкалы
export const getNoteColor = (
  pitch?: number,
  refFreq?: number
): string | null => {
  const maxDiff = 3; // Гц для полного красного
  if (!pitch || !refFreq) return null;
  const diff = Math.abs(pitch - refFreq);
  const t = Math.min(diff / maxDiff, 1); // 0..1
  const r = Math.round(255 * t); // красный растет с удалением
  const g = Math.round(255 * (1 - t)); // зелёный уменьшается
  return `rgb(${r},${g},0)`;
};

const NotePitch: FC<{
  pitch?: number;
  refFreq?: number;
}> = ({ pitch = 0, refFreq = 0 }) => {
  const { width } = Dimensions.get("window");
  const gaugeColor = useSharedValue(palette.tuner.center);
  const gaugeX = useSharedValue(width / 2);
  const gaugeRadius = useSharedValue(8);
  useEffect(() => {
    if (refFreq > 0 && pitch > 0) {
      const cents = 1200 * Math.log2(pitch / refFreq);
      const maxCents = 300;
      const normalized = Math.max(-1, Math.min(1, cents / maxCents));
      gaugeX.value = withSpring(width / 2 + normalized * (GAUGE_WIDTH / 2));
      gaugeRadius.value = withSpring(8 + Math.abs(normalized) * 6);
      gaugeColor.value = getNoteColor(pitch, refFreq) || palette.tuner.center;
    } else {
      gaugeX.value = withSpring(width / 2);
      gaugeRadius.value = withSpring(8);
      gaugeColor.value = palette.tuner.center;
    }
  }, [pitch, refFreq]);

  // линии сетки
  const lines = [
    {
      p1: { x: width / 2 - GAUGE_WIDTH / 2, y: 0 },
      p2: { x: width / 2 + GAUGE_WIDTH / 2, y: 0 },
      strokeWidth: 2,
      color: gaugeColor
    },
    {
      p1: { x: width / 2, y: -10 },
      p2: { x: width / 2, y: 10 },
      strokeWidth: 2,
      color: palette.colors.primary
    }
  ];

  return (
    <Group transform={[{ translateY: TRANSLATE_Y_GAUGE }]}>
      {lines.map((props, i) => (
        <Line key={i} {...props} style="stroke" />
      ))}
      <Circle cx={gaugeX} cy={0} r={gaugeRadius}>
        <Paint style="fill" color={gaugeColor} />
        <Paint style="stroke" color={palette.colors.white} strokeWidth={2} />
      </Circle>
    </Group>
  );
};

export default NotePitch;
