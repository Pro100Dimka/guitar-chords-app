import { BlurMask, Group, Line, Circle } from "@shopify/react-native-skia";
import React, { FC } from "react";
import { INote } from "@/@interfaces";
import {
  DerivedValue,
  SharedValue,
  useDerivedValue,
  withTiming
} from "react-native-reanimated";

const NotePitch: FC<{
  note: SharedValue<INote | null>;
  width: number;
  color: DerivedValue<number[]>;
}> = ({ note, width, color }) => {
  const visible = useDerivedValue(() => {
    const value = note.value;
    return value &&
      Number.isFinite(value.pitch) &&
      value.pitch > 0 &&
      Number.isFinite(value.refFreq) &&
      value.refFreq > 0
      ? 1
      : 0;
  });
  const position = useDerivedValue(() => {
    const value = note.value;
    const cents =
      visible.value && value
        ? 1200 * Math.log2(value.pitch / value.refFreq)
        : 0;
    return withTiming((Math.max(-1, Math.min(1, cents / 50)) * width) / 2, {
      duration: 120
    });
  });
  return (
    <Group>
      <Line
        p1={{ x: -width / 2, y: 0 }}
        p2={{ x: width / 2, y: 0 }}
        color="#F0FBFB"
        strokeWidth={3.4}
      />
      {Array.from({ length: 9 }, (_, index) => {
        const x = (index / 8 - 0.5) * width;
        return (
          <Line
            key={index}
            p1={{ x, y: -18 }}
            p2={{ x, y: 20 }}
            color="#EFF9F8"
            strokeWidth={4.8}
          />
        );
      })}
      <Group opacity={visible}>
        <Circle cx={position} cy={0} r={72} color={color} opacity={0.2}>
          <BlurMask blur={20} />
        </Circle>
        <Circle
          cx={position}
          cy={0}
          r={49}
          color={color}
          style="stroke"
          strokeWidth={4}
          opacity={0.25}
        />
        <Circle
          cx={position}
          cy={0}
          r={34}
          color={color}
          style="stroke"
          strokeWidth={7}
          opacity={0.6}
        >
          <BlurMask blur={4} />
        </Circle>
        <Circle
          cx={position}
          cy={0}
          r={30}
          color={color}
          style="stroke"
          strokeWidth={4}
        />
        <Circle cx={position} cy={0} r={22} color="#FFFFFF" />
      </Group>
    </Group>
  );
};
export default NotePitch;
