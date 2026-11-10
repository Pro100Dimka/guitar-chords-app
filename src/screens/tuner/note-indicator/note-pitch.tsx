import { Group, Line, Circle } from "@shopify/react-native-skia";
import React, { FC, useEffect } from "react";
import { useSharedValue, withTiming } from "react-native-reanimated";
import palette from "@/theme/palette";

const NotePitch: FC<{ pitch: number; refFreq: number; width: number }> = ({
  pitch,
  refFreq,
  width
}) => {
  const voiced =
    Number.isFinite(pitch) &&
    pitch > 0 &&
    Number.isFinite(refFreq) &&
    refFreq > 0;
  const cents = voiced ? 1200 * Math.log2(pitch / refFreq) : 0;
  const target = (Math.max(-1, Math.min(1, cents / 50)) * width) / 2;
  const position = useSharedValue(target);
  useEffect(() => {
    position.value = withTiming(target, { duration: 120 });
  }, [target, position]);
  const colors = palette.guitarDial;
  const color =
    voiced && Math.abs(cents) <= 5 ? colors.tuned : colors.engraving;
  return (
    <Group>
      <Line
        p1={{ x: -width / 2, y: 0 }}
        p2={{ x: width / 2, y: 0 }}
        color={colors.track}
        strokeWidth={1}
      />
      {Array.from({ length: 11 }, (_, index) => {
        const x = (index / 10 - 0.5) * width;
        const tickHeight = index === 5 ? 5 : 2.5;
        return (
          <Line
            key={index}
            p1={{ x, y: -tickHeight }}
            p2={{ x, y: tickHeight }}
            color={colors.engraving}
            strokeWidth={index === 5 ? 1.5 : 0.8}
          />
        );
      })}
      {voiced && <Circle cx={position} cy={0} r={3.5} color={color} />}
    </Group>
  );
};
export default NotePitch;
