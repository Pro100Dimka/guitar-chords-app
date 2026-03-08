/* eslint-disable react-hooks/exhaustive-deps */
// src/tuner/note-indicator/note-pitch-indicator.tsx
import { Group, Line, Circle, Paint } from "@shopify/react-native-skia";
import React, { FC, useEffect } from "react";
import { useSharedValue, withSpring } from "react-native-reanimated";
import palette from "@/theme/palette";
import { Dimensions } from "react-native";

export const TRANSLATE_Y_GAUGE = 90 + 32; // высота блока ноты + отступ
const GAUGE_WIDTH = 350; // ширина шкалы

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
      if (Math.abs(cents) < 10) gaugeColor.value = palette.tuner.center;
      else if (cents > 0) gaugeColor.value = palette.tuner.high;
      else gaugeColor.value = palette.tuner.low;
      // радиус увеличивается при большом отклонении
      gaugeRadius.value = withSpring(8 + Math.abs(normalized) * 6);
    } else {
      gaugeX.value = withSpring(width / 2);
      gaugeColor.value = palette.tuner.center;
      gaugeRadius.value = withSpring(8);
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
