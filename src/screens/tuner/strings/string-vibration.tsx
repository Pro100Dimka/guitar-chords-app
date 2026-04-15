import {
  useSharedValue,
  withTiming,
  withRepeat,
  cancelAnimation
} from "react-native-reanimated";
import {
  Circle,
  Paint,
  Path,
  RadialGradient,
  Shader,
  Skia,
  usePathInterpolation,
  vec
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
  amplitude = 0,
  frequency = 0.4,
  harmonics = true
) => {
  const path = Skia.Path.Make();
  const steps = 80;
  const dy = (bottom - top) / steps;
  for (let i = 0; i <= steps; i++) {
    // отражаем Y
    const y = bottom - i * dy; // ← переворот строки
    const damping = Math.exp(-i / steps);
    let offset = amplitude * Math.sin(i * frequency * Math.PI * 2) * damping;
    if (harmonics) {
      offset +=
        amplitude * 0.3 * Math.sin(i * frequency * Math.PI * 4 + 0.5) * damping;
    }
    const px = x + offset;
    if (i === 0) path.moveTo(px, y);
    else path.lineTo(px, y);
  }
  return path;
};
const StringWithVibration: FC<StringWithVibrationProps> = ({
  x,
  top,
  bottom,
  thickness,
  baseColor,
  active,
  volume = 0
}) => {
  const progress = useSharedValue(0);
  const [path1, path2] = useMemo(
    () => [
      getStringPath(x, top, bottom, 0),
      getStringPath(x, top, bottom, Math.min(volume * 100, 15))
    ],
    [x, top, bottom, volume]
  );
  useEffect(() => {
    if (active && volume > 0) {
      progress.value = withRepeat(
        withTiming(1, { duration: 180 }, () => {
          // затухание с экспонентой
          progress.value = withTiming(0, { duration: 1200 });
        }),
        1
      );
    } else {
      cancelAnimation(progress);
      progress.value = 0;
    }
  }, [active, volume, progress]);
  const animatedPath = usePathInterpolation(progress, [0, 1], [path1, path2]);
  return (
    <>
      <Path path={animatedPath} style="stroke" strokeWidth={thickness}>
        <Shader source={effect!} uniforms={{ thickness, baseColor }} />
      </Path>
      <Circle cx={x} cy={bottom} r={10}>
        <RadialGradient
          c={vec(x, bottom)}
          r={10}
          colors={["#ffffff", "#ffffff", "#949494"]}
        />
      </Circle>
    </>
  );
};

export default StringWithVibration;
