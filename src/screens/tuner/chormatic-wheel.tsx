import React, { useState } from "react";
import {
  Circle,
  Oval,
  BlurMask,
  RoundedRect,
  Text,
  Group,
  Line,
  SweepGradient,
  LinearGradient,
  Shadow,
  useFont,
  vec
} from "@shopify/react-native-skia";
import {
  SharedValue,
  useAnimatedReaction,
  useDerivedValue,
  withTiming
} from "react-native-reanimated";
import { runOnJS } from "react-native-worklets";
import { useTranslation } from "react-i18next";
import { INote } from "@/@interfaces";
import palette from "@/theme/palette";
import fontFamilies from "../../../assets/fonts/index";

const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export function chromaticLayout(width: number, height: number) {
  const scale = Math.max(
    0.25,
    Math.min(width / 410, height / 690, (height * 0.57 - 52) / 324, 1.4)
  );
  const centerY = height * 0.43;
  const stripWidth = Math.min((width - 32) / scale, 320);
  const artworkScale = Math.max(scale * 0.82, width / 1024);
  return {
    scale,
    centerY,
    stripWidth,
    artworkScale,
    artwork: {
      width: 1024 * artworkScale,
      height: 2216 * artworkScale,
      left: width / 2 - 518 * artworkScale,
      top: centerY - 1205 * artworkScale
    },
    octaveTop: centerY + 324 * scale,
    octaveWidth: stripWidth * scale - 20
  };
}
const { ink, muted } = palette.chromatic;

interface ChromaticWheelProps {
  note: SharedValue<INote | null>;
  width: number;
  height: number;
}

const ChromaticWheel: React.FC<ChromaticWheelProps> = ({
  note,
  width,
  height
}) => {
  const { t } = useTranslation();
  const [currentNote, setCurrentNote] = useState<INote | null>(null);
  const small = useFont(fontFamilies.Roboto[1], 13);
  const label = useFont(fontFamilies.Roboto[0], 21);
  const number = useFont(fontFamilies.Roboto[1], 18);
  const octaveFont = useFont(fontFamilies.Roboto[0], 25);
  const main = useFont(fontFamilies.Roboto[1], 80);
  const { scale, centerY, stripWidth, artworkScale } = chromaticLayout(
    width,
    height
  );
  const spacing = (stripWidth - 16) / notes.length;

  useAnimatedReaction(
    () => {
      const value = note.value;
      if (
        !value ||
        value.pitch <= 0 ||
        value.refFreq <= 0 ||
        !Number.isFinite(value.pitch)
      )
        return null;
      return value;
    },
    (next, previous) => {
      if (
        next?.name !== previous?.name ||
        next?.octave !== previous?.octave ||
        next?.pitch !== previous?.pitch ||
        next?.refFreq !== previous?.refFreq
      ) {
        runOnJS(setCurrentNote)(next);
      }
    }
  );
  const deviation = useDerivedValue(() => {
    const value = note.value;
    return value &&
      value.pitch > 0 &&
      value.refFreq > 0 &&
      Number.isFinite(value.pitch)
      ? 1200 * Math.log2(value.pitch / value.refFreq)
      : 0;
  });
  const angle = useDerivedValue(() =>
    withTiming(
      ((Math.max(-50, Math.min(50, deviation.value)) / 50) * Math.PI) / 3 -
        Math.PI / 2,
      { duration: 110 }
    )
  );
  const needleStart = useDerivedValue(() =>
    vec(Math.cos(angle.value) * 78, Math.sin(angle.value) * 78)
  );
  const needleEnd = useDerivedValue(() =>
    vec(Math.cos(angle.value) * 148, Math.sin(angle.value) * 148)
  );
  const haloX = useDerivedValue(() => Math.cos(angle.value) * 141);
  const haloY = useDerivedValue(() => Math.sin(angle.value) * 141);
  const indicatorColor = useDerivedValue(() =>
    Math.abs(deviation.value) <= 5 ? "#9DFF29" : "#FFBE25"
  );
  const indicatorOpacity = useDerivedValue(() =>
    withTiming(
      note.value && note.value.pitch > 0 && note.value.refFreq > 0 ? 1 : 0,
      { duration: 150 }
    )
  );

  if (!small || !label || !number || !octaveFont || !main) return null;
  const deviationCents = currentNote
    ? 1200 * Math.log2(currentNote.pitch / currentNote.refFreq)
    : 0;
  const cents = Math.round(deviationCents);
  const inTune = Math.abs(deviationCents) <= 5;
  const name = currentNote?.name.charAt(0) ?? "-";
  const accidental = currentNote?.name.includes("#") ? "#" : "";
  const octave = currentNote ? String(currentNote.octave) : "";
  const noteWidth =
    main.getTextWidth(name) +
    (octave
      ? Math.max(
          octaveFont.getTextWidth(octave),
          octaveFont.getTextWidth(accidental)
        ) + 5
      : 0);
  const frequency = currentNote
    ? `${currentNote.pitch.toFixed(2)} Hz`
    : t("TunerPlayNote");
  const offset = currentNote
    ? `${cents > 0 ? "+" : ""}${cents} ${t("TunerCents")}`
    : t("TunerListening");
  const status = t(
    !currentNote
      ? "TunerListening"
      : inTune
        ? "TunerInTune"
        : cents < 0
          ? "TunerTuneUp"
          : "TunerTuneDown"
  );
  return (
    <Group
      transform={[
        { translateX: width / 2 },
        { translateY: centerY },
        { scale }
      ]}
    >
      <Group
        clip={{
          x: -width / scale,
          y: (-205 * artworkScale) / scale,
          width: (2 * width) / scale,
          height: (500 * artworkScale) / scale
        }}
      >
        <Oval
          x={(-274 * artworkScale) / scale}
          y={(-250 * artworkScale) / scale}
          width={(548 * artworkScale) / scale}
          height={(500 * artworkScale) / scale}
          color="#080B0B"
        />
      </Group>
      <Circle cx={0} cy={3} r={148} color="#080C0E">
        <Shadow dx={0} dy={4} blur={9} color="rgba(255,157,0,0.25)" />
      </Circle>
      <Circle
        cx={0}
        cy={0}
        r={145}
        style="stroke"
        strokeWidth={1}
        color="#5F4B0D"
      />
      <Circle cx={0} cy={0} r={141} style="stroke" strokeWidth={4}>
        <SweepGradient
          c={vec(0, 0)}
          colors={[
            "#FF3106",
            "#9D4903",
            "#6B4807",
            "#FFC913",
            "#E5E71C",
            "#8EFF05",
            "#FFC01B",
            "#FF3106"
          ]}
          positions={[0, 0.16, 0.35, 0.5, 0.65, 0.75, 0.86, 1]}
        />
      </Circle>
      <Circle cx={0} cy={0} r={136}>
        <LinearGradient
          start={vec(0, -136)}
          end={vec(0, 136)}
          colors={["#0B1518", "#010304"]}
        />
      </Circle>
      <Circle
        cx={0}
        cy={0}
        r={134}
        style="stroke"
        strokeWidth={1}
        color="#604408"
      />
      {Array.from({ length: 61 }, (_, i) => {
        const a = -Math.PI / 6 + ((i / 60) * Math.PI * 4) / 3;
        return (
          <Line
            key={`lower-${i}`}
            p1={vec(
              Math.cos(a) * (i % 5 === 0 ? 114 : 122),
              Math.sin(a) * (i % 5 === 0 ? 114 : 122)
            )}
            p2={vec(Math.cos(a) * 130, Math.sin(a) * 130)}
            color={i < 15 ? "#CA3D06" : "#A47E12"}
            strokeWidth={1}
          />
        );
      })}
      {Array.from({ length: 41 }, (_, i) => {
        const a = (-Math.PI * 5) / 6 + ((i / 40) * Math.PI * 2) / 3;
        const inner = i % 5 === 0 ? 112 : 120;
        return (
          <Line
            key={i}
            p1={vec(Math.cos(a) * inner, Math.sin(a) * inner)}
            p2={vec(Math.cos(a) * 130, Math.sin(a) * 130)}
            color={
              Math.abs(i - 20) <= 7 ? "#9DFF29" : i > 27 ? "#FF640A" : "#EFCF15"
            }
            strokeWidth={i === 20 ? 2 : 1}
          />
        );
      })}
      {[-50, -25, 0, 25, 50].map((value) => {
        const a = ((value / 50) * Math.PI) / 3 - Math.PI / 2;
        const text = value > 0 ? `+${value}` : String(value);
        const radius = value === 0 ? 155 : 170;
        return (
          <Text
            key={value}
            x={Math.cos(a) * radius - number.getTextWidth(text) / 2}
            y={Math.sin(a) * radius + 5}
            text={text}
            font={number}
            color={ink}
          />
        );
      })}
      <Group opacity={indicatorOpacity}>
        <Line
          p1={needleStart}
          p2={needleEnd}
          color={indicatorColor}
          strokeWidth={14}
          opacity={0.65}
        >
          <BlurMask blur={12} style="normal" />
        </Line>
        <Circle
          cx={haloX}
          cy={haloY}
          r={10}
          color={indicatorColor}
          opacity={0.85}
        >
          <BlurMask blur={8} style="normal" />
        </Circle>
        <Line
          p1={needleStart}
          p2={needleEnd}
          color={indicatorColor}
          strokeWidth={7}
        >
          <BlurMask blur={3} style="normal" />
        </Line>
        <Line
          p1={needleStart}
          p2={needleEnd}
          color={indicatorColor}
          strokeWidth={4}
        />
        <Line
          p1={needleStart}
          p2={needleEnd}
          color="#F5FFE9"
          strokeWidth={1.7}
        />
      </Group>
      <Text x={-noteWidth / 2} y={18} text={name} font={main} color={ink} />
      <Text
        x={-noteWidth / 2 + main.getTextWidth(name) + 5}
        y={-24}
        text={accidental}
        font={octaveFont}
        color={ink}
      />
      <Text
        x={-noteWidth / 2 + main.getTextWidth(name) + 5}
        y={16}
        text={octave}
        font={octaveFont}
        color={ink}
      />
      <Text
        x={-label.getTextWidth(frequency) / 2}
        y={56}
        text={frequency}
        font={label}
        color={ink}
      />
      <Text
        x={-small.getTextWidth(offset) / 2}
        y={89}
        text={offset}
        font={small}
        color={inTune ? muted : "#FFCA3A"}
      />
      <RoundedRect
        x={-stripWidth / 2}
        y={246}
        width={stripWidth}
        height={78 + 52 / scale}
        r={16}
        color={palette.chromatic.panel}
      />
      <RoundedRect
        x={-stripWidth / 2}
        y={246}
        width={stripWidth}
        height={78 + 52 / scale}
        r={16}
        style="stroke"
        strokeWidth={1}
        color={palette.chromatic.border}
      />
      <Text
        x={-small.getTextWidth(status) / 2}
        y={270}
        text={status}
        font={small}
        color={ink}
      />
      {notes.map((item, i) => {
        const x = -stripWidth / 2 + 8 + spacing * i;
        const active = currentNote?.name === item;
        return (
          <Group key={item}>
            {active && (
              <RoundedRect
                x={x + 1}
                y={282}
                width={spacing - 2}
                height={30}
                r={7}
                color={palette.chromatic.selected}
              />
            )}
            <Text
              x={x + (spacing - small.getTextWidth(item)) / 2}
              y={302}
              text={item}
              font={small}
              color={active ? palette.gold.ink : muted}
            />
          </Group>
        );
      })}
      <Line
        p1={vec(-stripWidth / 2 + 20, 322)}
        p2={vec(stripWidth / 2 - 20, 322)}
        color={palette.glass.edge}
        strokeWidth={1}
      />
    </Group>
  );
};

export default ChromaticWheel;
