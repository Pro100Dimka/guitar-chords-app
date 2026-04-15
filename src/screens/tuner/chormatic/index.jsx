import React from "react";
import { Canvas, vec } from "@shopify/react-native-skia";
import ChormaticCircle from "./circle";
import MainNote from "./main-note";
import { Dimensions, StyleSheet } from "react-native";
import Notes from "./notes";
import palette from "@/theme/palette";

const TunerSkia = () => {
  const { width, height } = Dimensions.get("window");
  const [centerX, centerY] = [width / 2, height / 3];
  const [maxRadius, gap] = [centerX * 0.85, centerX * 0.09];
  const octaves = 8;
  const minRadius = maxRadius - octaves * gap;
  const center = vec(centerX, centerY);
  return (
    <Canvas style={styles.flex}>
      <Notes
        center={center}
        maxRadius={maxRadius}
        centerX={centerX}
        centerY={centerY}
      />
      <ChormaticCircle
        octaves={octaves}
        maxRadius={maxRadius}
        gap={gap}
        centerX={centerX}
        centerY={centerY}
      />
      <MainNote
        center={center}
        minRadius={minRadius}
        centerX={centerX}
        centerY={centerY}
      />
    </Canvas>
  );
};
const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: palette.colors.blackOpacity }
});
export default TunerSkia;
