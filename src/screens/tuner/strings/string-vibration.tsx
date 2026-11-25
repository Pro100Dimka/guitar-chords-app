import {
  useSharedValue,
  withTiming,
  withRepeat,
  cancelAnimation,
  useDerivedValue,
  useAnimatedReaction,
  Easing
} from "react-native-reanimated";
import {
  Circle,
  Path,
  Shader,
  Skia,
  usePathInterpolation
} from "@shopify/react-native-skia";
import { FC, useEffect, useMemo } from "react";
import { StringWithVibrationProps } from "@/@interfaces";
const effect = Skia.RuntimeEffect.Make(`
  uniform float thickness;
  uniform vec3 baseColor;
  float hash(vec2 p) {
   return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
 }
 half4 main(vec2 xy) {
  float scale = 12.0 / thickness;
  float coilWave = sin((xy.y * scale) + (xy.x * 1.5));
  float coil = coilWave * 0.5 + 0.5;
  float groove = smoothstep(0.35, 0.65, coil);
  float depth = mix(0.5, 1.3, groove);
  vec3 color = baseColor * depth;
  float anisotropic = pow(abs(cos(xy.y * scale)), 8.0);
  color += vec3(1.0) * anisotropic * 0.3;
  float centerHighlight = exp(-pow(xy.x * (0.15 / thickness), 2.0));
  color += vec3(1.0) * centerHighlight * 0.4;
  float scratch = hash(xy * vec2(0.2, 0.05)) * 0.08;
  color -= scratch * 0.1;
  float edgeShade = smoothstep(0.0, thickness * 0.5, abs(xy.x));
  color *= mix(1.0, 0.85, edgeShade);
  return half4(color, 1.0);
}
`);

const getStringPath = (
  x: number,
  top: number,
  bottom: number,
  amplitude: number,
  topX = x
) => {
  const path = Skia.Path.Make();
  const steps = 32;
  const visibleTop = Math.max(0, top);
  const dy = (bottom - visibleTop) / steps;
  for (let i = 0; i <= steps; i++) {
    const y = visibleTop + i * dy;
    const offset = amplitude * Math.sin(((y - top) / (bottom - top)) * Math.PI);
    const px = topX + (x - topX) * ((y - top) / (bottom - top)) + offset;
    if (i === 0) path.moveTo(px, y);
    else path.lineTo(px, y);
  }
  return path;
};
const StringWithVibration: FC<StringWithVibrationProps> = ({
  x,
  topX = x,
  top,
  bottom,
  thickness,
  baseColor,
  active,
  volume,
  plucks,
  index
}) => {
  const progress = useSharedValue(0);
  const pluckAmplitude = useSharedValue(0);
  const lastPluck = useSharedValue(0);
  const oscillating = useSharedValue(false);
  const [path1, path2] = useMemo(
    () => [
      getStringPath(x, top, bottom, -Math.min(9, 4 + thickness), topX),
      getStringPath(x, top, bottom, Math.min(9, 4 + thickness), topX)
    ],
    [x, topX, top, bottom, thickness]
  );
  useAnimatedReaction(
    () => plucks.value[index] ?? 0,
    (next) => {
      if (next === lastPluck.value) return;
      lastPluck.value = next;
      if (!next) {
        pluckAmplitude.value = 0;
        return;
      }
      pluckAmplitude.value = 1;
      pluckAmplitude.value = withTiming(0, {
        duration: 3000,
        easing: Easing.out(Easing.exp)
      });
    }
  );
  useAnimatedReaction(
    () => (active && volume.value > 0.003) || pluckAmplitude.value > 0.003,
    (sounding) => {
      if (sounding === oscillating.value) return;
      oscillating.value = sounding;
      if (sounding) {
        progress.value = withRepeat(
          withTiming(1, {
            duration: Math.max(35, 70 - index * 6),
            easing: Easing.inOut(Easing.sin)
          }),
          -1,
          true
        );
      } else {
        cancelAnimation(progress);
        progress.value = 0;
      }
    }
  );
  useEffect(
    () => () => {
      cancelAnimation(progress);
      cancelAnimation(pluckAmplitude);
    },
    [progress, pluckAmplitude]
  );
  const amplitude = useDerivedValue(() =>
    withTiming(active ? Math.min(Math.max(volume.value, 0) / 0.15, 1) : 0, {
      duration: 100
    })
  );
  const vibration = useDerivedValue(
    () =>
      0.5 +
      (progress.value - 0.5) * Math.max(amplitude.value, pluckAmplitude.value)
  );
  const animatedPath = usePathInterpolation(vibration, [0, 1], [path1, path2]);
  return (
    <>
      <Path path={animatedPath} style="stroke" strokeWidth={thickness}>
        <Shader source={effect!} uniforms={{ thickness, baseColor }} />
      </Path>
      <Circle cx={x} cy={bottom} r={1.5} color="#514033" />
    </>
  );
};

export default StringWithVibration;
