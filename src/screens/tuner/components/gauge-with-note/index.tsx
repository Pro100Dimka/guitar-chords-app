// src/screens/tuner/components/gauge-with-note/index.tsx
import { Group } from "@shopify/react-native-skia";
import { FC, memo, useEffect } from "react";
import { useWindowDimensions } from "react-native";
import {
  cancelAnimation,
  useSharedValue,
  withTiming
} from "react-native-reanimated";
import { BUF_PER_SEC, GAUGE_WIDTH } from "../../const";
import { IMainNoteProps } from "@/@interfaces";
import Gauge from "./gauge";
import GaugeNote from "./note";

const GaugeWithNote: FC<IMainNoteProps> = (props) => {
  const { gaugeDeviation = 0, gaugeColor } = props;
  const { width } = useWindowDimensions();
  const centerX = width / 2;
  const gaugeRadius = GAUGE_WIDTH / 2 + 2;
  const gaugeX = useSharedValue(centerX * gaugeDeviation);
  useEffect(() => {
    gaugeX.value = withTiming(centerX * (1 + gaugeDeviation), {
      duration: 1000 / BUF_PER_SEC
    });
    return () => cancelAnimation(gaugeX);
  }, [gaugeDeviation, centerX, gaugeX]);
  return (
    <Group>
      <GaugeNote {...props} width={width} />
      <Gauge
        gaugeX={gaugeX}
        gaugeRadius={gaugeRadius}
        gaugeColor={gaugeColor}
        width={width}
      />
    </Group>
  );
};
export default memo(GaugeWithNote, (prev, next) => {
  return (
    prev.gaugeDeviation === next.gaugeDeviation &&
    prev.gaugeColor === next.gaugeColor
  );
});
