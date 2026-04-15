import React, { FC } from "react";
import {
  Group,
  Circle,
  vec,
  Blur,
  LinearGradient,
  Path,
  Shadow
} from "@shopify/react-native-skia";
interface IMainNote {
  centerX: number;
  centerY: number;
  minRadius: number;
  center: { x: number; y: number };
}
const MainNote: FC<IMainNote> = (props) => {
  const { centerX, centerY, minRadius, center } = props;
  const arrowPath =
    "M 0 40 L 15 40 C 5 35 4 11 8 1 C 11 1 16 5 18 9 L 0 -40 Z M 0 40 L -15 40 C -5 35 -4 11 -8 1 C -11 1 -16 5 -18 9 L 0 -40 Z";
  return (
    <Group>
      <Group>
        <Circle c={center} r={minRadius}>
          <LinearGradient
            start={vec(centerX, centerY - 30)}
            end={vec(centerX, centerY + 30)}
            colors={["#ffdf80", "#ff8c00"]}
          />
          <Blur blur={15} />
        </Circle>
      </Group>
      <Group transform={[{ translateX: center.x }, { translateY: center.y }]}>
        <Path path={arrowPath} color="#ffcc33">
          <Blur blur={10} />
        </Path>
        <Path path={arrowPath}>
          <LinearGradient
            start={vec(0, -60)}
            end={vec(0, 30)}
            colors={["#ffffcc", "#ffcc33", "#e67e22"]}
          />
          <Shadow dx={0} dy={0} blur={5} color="#fff" inner />
        </Path>
      </Group>
      {/* <Circle
        c={center}
        r={minRadius}
        style="stroke"
        strokeWidth={3}
        color="#ffcc33"
      >
        <Blur blur={2} />
      </Circle> */}
    </Group>
  );
};
export default MainNote;
