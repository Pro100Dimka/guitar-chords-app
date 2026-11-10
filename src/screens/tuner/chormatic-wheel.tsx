import React, { useState } from "react";
import {
  Circle,
  Text,
  Group,
  Line,
  RoundedRect,
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
const { ink, muted, brass } = palette.chromatic;

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
  const small = useFont(fontFamilies.Roboto[1], 10);
  const label = useFont(fontFamilies.Roboto[0], 13);
  const number = useFont(fontFamilies.Roboto[1], 17);
  const octaveFont = useFont(fontFamilies.Roboto[0], 25);
  const main = useFont(fontFamilies.Roboto[1], 80);
  const scale = Math.max(0.25, Math.min(width / 420, height / 668, 1.3));
  const centerY = height * 0.365;

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
  const indicatorX = useDerivedValue(() => Math.cos(angle.value) * 119);
  const indicatorY = useDerivedValue(() => Math.sin(angle.value) * 119);
  const indicatorColor = useDerivedValue(() =>
    Math.abs(deviation.value) <= 5 ? "#537C60" : "#A66C36"
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
  const state = !currentNote
    ? "TunerListening"
    : inTune
      ? "TunerInTune"
      : cents < 0
        ? "TunerTuneUp"
        : "TunerTuneDown";
  const status = t(state);
  const title = t("TunerChromatic").toUpperCase();
  const frequency = currentNote
    ? `${currentNote.pitch.toFixed(1)} Hz`
    : t("TunerPlayNote");
  const offset = currentNote
    ? `${cents > 0 ? "+" : ""}${cents} ${t("TunerCents")}`
    : "";
  const stripWidth = Math.min((width - 32) / scale, 380);
  const spacing = (stripWidth - 16) / notes.length;

  return (
    <Group
      transform={[
        { translateX: width / 2 },
        { translateY: centerY },
        { scale }
      ]}
    >
      <Circle cx={0} cy={4} r={150} color="#382615">
        <Shadow dx={0} dy={8} blur={12} color="rgba(28,16,8,0.42)" />
      </Circle>
      <Circle cx={0} cy={0} r={148}>
        <LinearGradient
          start={vec(-110, -145)}
          end={vec(100, 145)}
          colors={["#F0DFC0", "#B89560", "#715233", "#DCC299"]}
          positions={[0, 0.35, 0.7, 1]}
        />
      </Circle>
      <Circle
        cx={0}
        cy={0}
        r={143}
        style="stroke"
        strokeWidth={1}
        color="#F8E7C9"
      />
      <Circle cx={0} cy={0} r={139}>
        <LinearGradient
          start={vec(0, -139)}
          end={vec(0, 139)}
          colors={["#FFF9ED", "#F0E5D0"]}
        />
      </Circle>
      <Circle
        cx={0}
        cy={0}
        r={136}
        style="stroke"
        strokeWidth={1}
        color="#D9C8AA"
      />
      {Array.from({ length: 41 }, (_, i) => {
        const a = (-Math.PI * 5) / 6 + ((i / 40) * Math.PI * 2) / 3;
        const major = i % 5 === 0;
        const inner = major ? 106 : 113;
        return (
          <Line
            key={i}
            p1={vec(Math.cos(a) * inner, Math.sin(a) * inner)}
            p2={vec(Math.cos(a) * 122, Math.sin(a) * 122)}
            color={i === 20 ? "#537C60" : major ? muted : "#CAB999"}
            strokeWidth={i === 20 ? 2.5 : 1}
          />
        );
      })}
      {[
        [-50, -94, -46],
        [0, 0, -88],
        [50, 94, -46]
      ].map(([value, x, y]) => (
        <Text
          key={value}
          x={
            x - small.getTextWidth(value > 0 ? `+${value}` : String(value)) / 2
          }
          y={y}
          text={value > 0 ? `+${value}` : String(value)}
          font={small}
          color={muted}
        />
      ))}
      <Group opacity={indicatorOpacity}>
        <Circle cx={indicatorX} cy={indicatorY} r={7} color="#FFF9ED" />
        <Circle cx={indicatorX} cy={indicatorY} r={4} color={indicatorColor} />
      </Group>
      <Text
        x={-small.getTextWidth(title) / 2}
        y={-61}
        text={title}
        font={small}
        color={muted}
      />
      <Text x={-noteWidth / 2} y={25} text={name} font={main} color={ink} />
      <Text
        x={-noteWidth / 2 + main.getTextWidth(name) + 5}
        y={-20}
        text={accidental}
        font={octaveFont}
        color={ink}
      />
      <Text
        x={-noteWidth / 2 + main.getTextWidth(name) + 5}
        y={22}
        text={octave}
        font={octaveFont}
        color={muted}
      />
      <Text
        x={-number.getTextWidth(offset) / 2}
        y={55}
        text={offset}
        font={number}
        color={inTune ? "#537C60" : "#A66C36"}
      />
      <Line
        p1={vec(-38, 72)}
        p2={vec(38, 72)}
        color="#D3B98F"
        strokeWidth={1}
      />
      <Text
        x={-label.getTextWidth(frequency) / 2}
        y={95}
        text={frequency}
        font={label}
        color={muted}
      />
      <Circle cx={0} cy={116} r={2} color={brass} />
      <RoundedRect
        x={-stripWidth / 2}
        y={174}
        width={stripWidth}
        height={116}
        r={18}
        color={palette.chromatic.panel}
      />
      <RoundedRect
        x={-stripWidth / 2}
        y={174}
        width={stripWidth}
        height={116}
        r={18}
        style="stroke"
        strokeWidth={1}
        color={palette.chromatic.border}
      />
      <Text
        x={-label.getTextWidth(status) / 2}
        y={199}
        text={status}
        font={label}
        color="#F2E2C7"
      />
      {notes.map((item, i) => {
        const x = -stripWidth / 2 + 8 + spacing * i;
        const active = currentNote?.name === item;
        return (
          <Group key={item}>
            {active && (
              <RoundedRect
                x={x + 1}
                y={211}
                width={spacing - 2}
                height={30}
                r={7}
                color={palette.chromatic.selected}
              />
            )}
            <Text
              x={x + (spacing - small.getTextWidth(item)) / 2}
              y={231}
              text={item}
              font={small}
              color={active ? ink : "#D8C5A7"}
            />
          </Group>
        );
      })}
      <Line
        p1={vec(-stripWidth / 2 + 20, 252)}
        p2={vec(stripWidth / 2 - 20, 252)}
        color="rgba(229,201,154,0.25)"
        strokeWidth={1}
      />
      <Text
        x={-small.getTextWidth("A4 = 440 Hz") / 2}
        y={274}
        text="A4 = 440 Hz"
        font={small}
        color="#CCB58F"
      />
    </Group>
  );
};

export default ChromaticWheel;
