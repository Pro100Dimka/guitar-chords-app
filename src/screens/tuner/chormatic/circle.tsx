import React, { FC } from "react";
import { Group, Circle, vec, Blur, Shadow } from "@shopify/react-native-skia";
interface IChormaticCircle {
  octaves: number;
  maxRadius: number;
  gap: number;
  centerX: number;
  centerY: number;
}
const ChormaticCircle: FC<IChormaticCircle> = (props) => {
  const { octaves, maxRadius, gap, centerX, centerY } = props;
  return (
    <Group>
      {Array.from({ length: octaves }).map((_, i) => {
        const radius = maxRadius - i * gap;
        return (
          <Group key={i} style="stroke" strokeWidth={1.5}>
            <Circle
              c={vec(centerX, centerY)}
              r={radius}
              color="rgba(255, 180, 100, 0.8)"
            >
              <Blur blur={0.5} />
              <Shadow dx={0} dy={0} blur={3} color="#ff8c00" />
            </Circle>
          </Group>
        );
      })}
    </Group>
  );
};
export default ChormaticCircle;
