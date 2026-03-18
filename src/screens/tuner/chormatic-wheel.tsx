import React, { useEffect, useState } from "react";
import { Dimensions } from "react-native";
import {
  Circle,
  Text,
  Group,
  useFont,
  RadialGradient,
  SweepGradient,
  vec,
  FillType,
  Skia,
  Path
} from "@shopify/react-native-skia";
import {
  SharedValue,
  useDerivedValue,
  useSharedValue,
  withTiming,
  withRepeat,
  useAnimatedProps
} from "react-native-reanimated";
import { INote } from "@/@interfaces";
import { runOnJS } from "react-native-worklets";
import fontFamilies from "../../../assets/fonts/index";
const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const octaves = 8;
const sweepColors = [
  "#FF7A00", // ярко-оранжевый
  "#FFD400" // солнечный
];

interface ChromaticWheelProps {
  rms: SharedValue<number>;
  note: SharedValue<INote | null>;
}

const ChromaticWheel: React.FC<ChromaticWheelProps> = ({ note, rms }) => {
  const [currentNote, setCurrentNote] = useState<INote | null>(null);

  const centerX = Dimensions.get("window").width / 2;
  const centerY = Dimensions.get("window").height / 3;

  const radius = centerX * 0.83;

  const fontNote = useFont(fontFamilies.Roboto[2], 12);
  const fontMain = useFont(fontFamilies.Roboto[2], 20);
  const fontNotes = useFont(fontFamilies.Roboto[2], 16);

  const angleStep = (2 * Math.PI) / notes.length;

  const smoothedAngle = useSharedValue(0);
  const pulse = useSharedValue(1);

  const [gaugeColor, setGaugeColor] = useState("#39FF14");

  // 🎯 обновление ноты
  useDerivedValue(() => {
    runOnJS(setCurrentNote)(note.value);
  });

  // 💫 дыхание
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1.15, { duration: 800 }), -1, true);
  }, []);

  // 🎯 вычисление отклонения
  useEffect(() => {
    if (!currentNote || !currentNote.pitch || !currentNote.refFreq) return;

    const noteIndex = notes.indexOf(currentNote.name);

    // 🔥 отклонение (очень важно)
    const deviation = Math.log2(currentNote.pitch / currentNote.refFreq) * 12;

    // ограничим
    const clamped = Math.max(-0.5, Math.min(0.5, deviation));

    const baseAngle = noteIndex * angleStep;
    const offset = clamped * angleStep;

    const targetAngle = baseAngle + offset - Math.PI / 2;

    // 🧠 smoothing
    smoothedAngle.value = withTiming(targetAngle, {
      duration: 120
    });

    // 🎨 цвет (зелёный если точно)
    if (Math.abs(clamped) < 0.05) {
      setGaugeColor("#00FF88");
    } else {
      setGaugeColor("#FF4444");
    }
  }, [currentNote]);

  if (!fontNote || !fontMain) return null;
  const ringStep = radius / octaves;
  const octaveIndex = currentNote?.octave ?? 1;
  const r = ringStep * octaveIndex;

  return (
    <Group transform={[{ translateX: centerX }, { translateY: centerY }]}>
      {/* 🌈 цветовой круг */}
      <Circle cx={0} cy={0} r={radius}>
        <SweepGradient c={vec(0, 0)} colors={sweepColors} />
      </Circle>
      {Array.from({ length: octaves }).map((_, i) => {
        const outerR = ringStep * (i + 1);
        const innerR = ringStep * i + 2;
        const midR = (outerR + innerR) / 2;

        const isActive = currentNote?.octave === i + 1;

        const path = Skia.Path.Make();
        path.addCircle(0, 0, outerR);
        path.addCircle(0, 0, innerR);
        path.setFillType(FillType.EvenOdd);

        return (
          <Path key={`octave-ring-${i}`} path={path}>
            <RadialGradient
              c={vec(0, 0)}
              r={midR}
              colors={[
                isActive ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)",
                "transparent",
                "rgba(0,0,0,0.5)"
              ]}
              positions={[0, 0.6, 1]}
            />
          </Path>
        );
      })}
      {/* затемнение */}
      <Circle cx={0} cy={0} r={radius}>
        <RadialGradient
          c={vec(0, 0)}
          r={radius}
          colors={["transparent", "rgba(0,0,0,0.7)"]}
        />
      </Circle>

      {/* 💫 центр (реакция на звук) */}
      <Circle
        cx={0}
        cy={0}
        r={40 * pulse.value * (1 + Math.min(rms.value, 0.5) * 2)}
      >
        <RadialGradient c={vec(0, 0)} r={80} colors={[gaugeColor, "black"]} />
      </Circle>

      {/* 🎯 индикатор */}
      {currentNote && currentNote.name !== "Silence" && (
        <>
          {/* glow */}
          <Circle
            cx={r * Math.cos(smoothedAngle.value)}
            cy={r * Math.sin(smoothedAngle.value)}
            r={18}
            opacity={0.3}
            color={gaugeColor}
          />

          {/* точка */}
          <Circle
            cx={r * Math.cos(smoothedAngle.value)}
            cy={r * Math.sin(smoothedAngle.value)}
            r={6}
            color={gaugeColor}
          />

          {/* текст */}
          <Text
            x={
              -fontMain.getTextWidth(
                `${currentNote.name}${currentNote.octave}`
              ) / 2
            }
            y={fontMain.getSize() / 2}
            text={`${currentNote.name}${currentNote.octave}`}
            font={fontMain}
            color={gaugeColor}
          />
        </>
      )}

      {/* 🎵 подписи */}
      {notes.map((n, i) => {
        const angle = i * angleStep - Math.PI / 2;

        const r = radius * 1.15;

        const w = fontNote.getTextWidth(n);
        const h = fontNote.getSize();

        return (
          <Text
            key={n}
            x={r * Math.cos(angle) - w / 1.76}
            y={r * Math.sin(angle) + h / 1.5}
            text={n}
            font={fontNotes}
            color="#aaa"
          />
        );
      })}
      {notes.map((noteName, i) => {
        const angle = i * angleStep - Math.PI / 2;

        return (
          <Group key={`octaves-${noteName}`}>
            {Array.from({ length: octaves }).map((_, j) => {
              const r = ringStep * (j + 1);

              const x = r * Math.cos(angle);
              const y = r * Math.sin(angle);

              const isActive =
                currentNote?.name === noteName && currentNote?.octave === j + 1;

              return (
                <Text
                  key={`${noteName}-${j}`}
                  x={
                    x -
                    fontNote.getTextWidth(`${j === 0 ? "" : `${j + 1}`}`) / 2
                  }
                  y={y + fontNote.getSize() / 2}
                  text={j === 0 ? "" : `${j + 1}`}
                  font={fontNote}
                  color={isActive ? gaugeColor : "rgba(255,255,255,0.35)"}
                />
              );
            })}
          </Group>
        );
      })}
    </Group>
  );
};

export default ChromaticWheel;
