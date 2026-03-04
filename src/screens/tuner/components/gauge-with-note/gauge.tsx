import { Group, Line, Circle, Paint } from "@shopify/react-native-skia";
import { FC } from "react";
import { useDerivedValue } from "react-native-reanimated";
import Colors from "../../colors";
import { GAUGE_WIDTH } from "../../const";
import { IGaugeProps } from "@/@interfaces";
import { Point } from "@/@types";
import { hght } from "./note";

const { primary, secondary } = Colors;
export const TRANSLATE_Y_GAUGE = hght + 32;
export const makeLine = (
  p1: Point,
  p2: Point,
  strokeWidth: number,
  color: string,
  strokeCap: "round" | "butt" | "square" = "butt"
) => ({ p1, p2, strokeWidth, color, strokeCap });

const Gauge: FC<IGaugeProps> = ({ gaugeX, gaugeRadius, gaugeColor, width }) => {
  const [x, g, gW] = [width / 2, GAUGE_WIDTH / 2, GAUGE_WIDTH];
  const gaugeXY = useDerivedValue(() => ({ x: gaugeX.value, y: 0 }));
  const lines = [
    makeLine({ x: g, y: 0 }, { x: width - g, y: 0 }, gW, secondary, "round"),
    makeLine({ x, y: 0 }, gaugeXY, GAUGE_WIDTH, gaugeColor),
    makeLine({ x, y: -gaugeRadius }, { x, y: gaugeRadius }, 1, primary)
  ];

  return (
    <Group transform={[{ translateY: TRANSLATE_Y_GAUGE }]}>
      {lines.map((props, i) => (
        <Line key={i} {...props} style="stroke" />
      ))}
      <Circle cx={gaugeX} cy={0} r={gaugeRadius}>
        <Paint style="fill" color={gaugeColor} />
        <Paint style="stroke" color={primary} strokeWidth={3} />
      </Circle>
    </Group>
  );
};

export default Gauge;
