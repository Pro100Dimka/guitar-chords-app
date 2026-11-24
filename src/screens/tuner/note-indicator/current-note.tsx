import React, { FC, useEffect } from "react";
import {
  BlurMask,
  Circle,
  Group,
  Line,
  LinearGradient,
  Oval,
  Path,
  RadialGradient,
  RoundedRect,
  Skia,
  Text,
  useFont,
  interpolateColors,
  vec
} from "@shopify/react-native-skia";
import {
  SharedValue,
  useDerivedValue,
  withTiming
} from "react-native-reanimated";
import { INote } from "@/@interfaces";
import fontFamilies from "../../../../assets/fonts";
import NotePitch from "./note-pitch";
import { guitarLayout } from "../guitar-layout";

const arc = Skia.Path.MakeFromSVGString(
  "M194.73 476.19 A454 454 0 0 1 1053.27 476.19"
)!;
const ticks = Array.from({ length: 47 }, (_, index) => {
  const angle = ((-161 + (142 * index) / 46) * Math.PI) / 180;
  const major = index % 5 === 0;
  const inner = 426 - (major ? 20 : 13);
  return {
    p1: vec(624 + Math.cos(angle) * 426, 624 + Math.sin(angle) * 426),
    p2: vec(624 + Math.cos(angle) * inner, 624 + Math.sin(angle) * inner),
    width: major ? 3 : 2.4
  };
});
const waveHeights = [
  1, 1, 1, 1, 1, 1, 1, 1, 1, 0.86, 0.97, 1.06, 1.29, 1.72, 2.16, 2.43, 2.66,
  3.23, 4.29, 5.4, 6.09, 6.66, 8.07, 10.7, 13.51, 15.28, 16.69, 20.16, 26.71,
  33.82, 38.35, 41.85, 50.37, 66.68, 84.66, 66.68, 50.37, 41.85, 38.35, 33.82,
  26.71, 20.16, 16.69, 15.28, 13.51, 10.7, 8.07, 6.66, 6.09, 5.4, 4.29, 3.23,
  2.66, 2.43, 2.16, 1.72, 1.29, 1.06, 0.97, 0.86, 1, 1, 1, 1, 1, 1, 1, 1, 1
];
const waveform = Skia.Path.Make();
waveHeights.forEach((amplitude, index) => {
  const x = 296.92 + index * 9.62;
  waveform.moveTo(x, 855 - amplitude);
  waveform.lineTo(x, 855 + amplitude);
});
const reflection = Skia.Path.MakeFromSVGString(
  "M956.54 883.81 A422 422 0 0 1 291.46 883.81"
)!;

const CurrentNote: FC<{
  note: SharedValue<INote | null>;
  name?: string;
  width: number;
  height: number;
  fill: SharedValue<number>;
  rms: SharedValue<number>;
  availableHeight?: number;
  onReady?: () => void;
  face?: { x: number; y: number; width: number; height: number };
  signal?: SharedValue<number[]>;
}> = ({
  fill,
  rms,
  name,
  note,
  width,
  height,
  availableHeight,
  onReady,
  face,
  signal
}) => {
  const hole = face ?? guitarLayout(width, height).hole;
  const centerX = hole.x + hole.width / 2;
  const centerY = hole.y + hole.height / 2;
  const faceScale = Math.min(hole.width, hole.height) / 952;
  const contentScale = Math.min(
    faceScale,
    (availableHeight ?? Infinity) / 1000
  );
  const family = face ? fontFamilies.Manrope : fontFamilies.Roboto;
  const noteFont = useFont(family[0], 234);
  const octaveFont = useFont(family[0], 112);
  const frequencySize = contentScale > 0 ? Math.max(59, 11 / contentScale) : 59;
  const frequencyFont = useFont(family[0], frequencySize);
  useEffect(() => {
    if (noteFont && octaveFont && frequencyFont) onReady?.();
  }, [noteFont, octaveFont, frequencyFont, onReady]);
  const voiced = useDerivedValue(() => {
    const value = note.value;
    return (
      !!value &&
      Number.isFinite(value.pitch) &&
      value.pitch > 0 &&
      Number.isFinite(value.refFreq) &&
      value.refFreq > 0
    );
  });
  const cents = useDerivedValue(() =>
    voiced.value && note.value
      ? 1200 * Math.log2(note.value.pitch / note.value.refFreq)
      : 0
  );
  const deviation = useDerivedValue(() =>
    withTiming(Math.min(50, Math.abs(cents.value)), { duration: 240 })
  );
  const activity = useDerivedValue(() =>
    withTiming(voiced.value ? 1 : 0, { duration: 200 })
  );
  const rotation = useDerivedValue(() =>
    withTiming(voiced.value ? Math.max(-1, Math.min(1, cents.value / 50)) : 0, {
      duration: 120
    })
  );
  const needleOpacity = useDerivedValue(() => (voiced.value ? 1 : 0));
  const glowOpacity = useDerivedValue(() => (voiced.value ? 0.4 : 0.15));
  const label = useDerivedValue(() =>
    voiced.value ? name || note.value?.name || "·" : "·"
  );
  const octaveLabel = useDerivedValue(() =>
    voiced.value ? String(note.value?.octave ?? "") : ""
  );
  const frequency = useDerivedValue(() =>
    voiced.value ? `${(note.value?.pitch ?? 0).toFixed(1)} Hz` : "·"
  );
  const labelWidth = useDerivedValue(
    () => noteFont?.getTextWidth(label.value) ?? 0
  );
  const labelX = useDerivedValue(
    () =>
      624 -
      (labelWidth.value + (octaveFont?.getTextWidth(octaveLabel.value) ?? 0)) /
        2
  );
  const octaveX = useDerivedValue(() => labelX.value + labelWidth.value);
  const frequencyX = useDerivedValue(
    () => 624 - (frequencyFont?.getTextWidth(frequency.value) ?? 0) / 2
  );
  const signalColor = useDerivedValue(() => {
    const color = interpolateColors(
      deviation.value,
      [5, 25, 50],
      ["#78FC00", "#FFCF42", "#FF3B35"]
    );
    return interpolateColors(activity.value, [0, 1], ["#778080", color]);
  });
  const arcColors = useDerivedValue(() => [
    interpolateColors(0.12, [0, 1], [signalColor.value, "#FFFFFF"]),
    signalColor.value,
    interpolateColors(0.25, [0, 1], ["#000000", signalColor.value])
  ]);
  const faceColors = useDerivedValue(() => [
    "#000303",
    "#020505",
    interpolateColors(0.14, [0, 1], ["#020303", signalColor.value])
  ]);
  const shineColors = useDerivedValue(() => {
    const color = interpolateColors(
      0.25,
      [0, 1],
      [signalColor.value, "#FFFFFF"]
    );
    return [0.16, 0.04, 0].map((alpha) => [
      color[0],
      color[1],
      color[2],
      alpha
    ]);
  });
  const needleTransform = useDerivedValue(() => [
    { rotate: (rotation.value * 71 * Math.PI) / 180 }
  ]);
  const level = useDerivedValue(() =>
    withTiming(Math.max(0, Math.min(1, rms.value / 0.12)), { duration: 100 })
  );
  const waveTransform = useDerivedValue(() => [
    { scaleY: 0.1 + 0.9 * level.value }
  ]);
  const liveWave = useDerivedValue(() => {
    if (!signal) return waveform;
    const path = Skia.Path.Make();
    const values = signal.value;
    values.forEach((value, index) => {
      const x = 296.92 + (index * 654) / Math.max(1, values.length - 1);
      if (values.length === 32) {
        path.moveTo(x, 900);
        path.lineTo(x, 900 - value * 130);
      } else {
        if (index === 0) path.moveTo(x, 855 - value * 84);
        else path.lineTo(x, 855 - value * 84);
      }
    });
    return path;
  });
  const fillClip = useDerivedValue(() => ({
    x: 148,
    y: 148 + 952 * (1 - fill.value),
    width: 952,
    height: 952 * fill.value
  }));
  if (!noteFont || !octaveFont || !frequencyFont) return null;
  const holeClip = Skia.Path.Make();
  holeClip.addOval(hole);
  return (
    <Group clip={holeClip}>
      <Oval {...hole} color="#020303" />
      <Group
        transform={[
          { translateX: centerX - 624 * faceScale },
          { translateY: centerY - 624 * faceScale },
          { scale: faceScale }
        ]}
      >
        <Circle cx={624} cy={624} r={476}>
          <RadialGradient
            c={vec(612, 520)}
            r={660}
            colors={faceColors}
            positions={[0, 0.65, 1]}
          />
        </Circle>
        <Group origin={vec(439, 330)} transform={[{ rotate: -Math.PI / 10 }]}>
          <Oval x={34} y={70} width={810} height={520}>
            <LinearGradient
              start={vec(100, 70)}
              end={vec(700, 590)}
              colors={shineColors}
            />
          </Oval>
        </Group>
        <Circle cx={624} cy={941} r={300} color={signalColor} opacity={0.07}>
          <BlurMask blur={80} />
        </Circle>
        <Path
          path={reflection}
          style="stroke"
          strokeWidth={2.1}
          color={signalColor}
          opacity={0.6}
        />
        <Oval
          x={450}
          y={1038}
          width={350}
          height={18}
          color={signalColor}
          opacity={0.4}
        >
          <BlurMask blur={4} />
        </Oval>
        <Group clip={fillClip}>
          <Circle
            cx={624}
            cy={624}
            r={476}
            color={signalColor}
            opacity={0.08}
          />
        </Group>
      </Group>
      <Group
        transform={[
          { translateX: centerX - 624 * contentScale },
          { translateY: centerY - 624 * contentScale },
          { scale: contentScale }
        ]}
      >
        <Path
          path={arc}
          style="stroke"
          strokeWidth={face ? 28 : 33}
          color={signalColor}
          opacity={glowOpacity}
        >
          <BlurMask blur={9} />
        </Path>
        <Path path={arc} style="stroke" strokeWidth={face ? 22 : 29}>
          <LinearGradient
            start={vec(0, 170)}
            end={vec(100, 1100)}
            colors={arcColors}
          />
        </Path>
        <Path
          path={arc}
          style="stroke"
          strokeWidth={2.1}
          color={signalColor}
          opacity={0.65}
        />
        {ticks.map((tick, index) => (
          <Line
            key={index}
            p1={tick.p1}
            p2={tick.p2}
            color={signalColor}
            strokeWidth={tick.width}
          />
        ))}
        <Group
          origin={vec(624, 624)}
          transform={needleTransform}
          opacity={needleOpacity}
        >
          <RoundedRect
            x={613}
            y={150}
            width={21}
            height={128}
            r={2}
            color={signalColor}
            opacity={0.7}
          >
            <BlurMask blur={4} />
          </RoundedRect>
          <RoundedRect
            x={615}
            y={154}
            width={17}
            height={121}
            r={1}
            color="#FFFFFF"
          />
        </Group>
        <Text x={labelX} y={510} text={label} font={noteFont} color="#FFFFFF">
          <LinearGradient
            start={vec(0, 280)}
            end={vec(0, 523)}
            colors={["#FFFFFF", "#FFFFFF", "#C4C9C9"]}
            positions={[0, 0.6, 1]}
          />
        </Text>
        <Text
          x={octaveX}
          y={523}
          text={octaveLabel}
          font={octaveFont}
          color="#F1F4F3"
        />
        <Group transform={[{ translateX: 624 }, { translateY: 628 }]}>
          <NotePitch note={note} width={722} color={signalColor} />
        </Group>
        <Text
          x={frequencyX}
          y={745}
          text={frequency}
          font={frequencyFont}
          color="#F8FCFA"
        />
        <Line
          p1={vec(284, 855)}
          p2={vec(954, 855)}
          color={signalColor}
          strokeWidth={3}
          opacity={0.3}
        />
        <Group origin={vec(624, 855)} transform={waveTransform}>
          <Path
            path={liveWave}
            style="stroke"
            strokeWidth={8}
            strokeCap="round"
            color={signalColor}
            opacity={0.35}
          >
            <BlurMask blur={4} />
          </Path>
          <Path
            path={liveWave}
            style="stroke"
            strokeWidth={3.2}
            strokeCap="round"
            color={signalColor}
          />
        </Group>
      </Group>
    </Group>
  );
};
export default React.memo(CurrentNote);
