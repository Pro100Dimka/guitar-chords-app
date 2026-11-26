import React, { Dispatch, SetStateAction, useEffect } from "react";
import LinearGradient from "react-native-linear-gradient";
import Svg, { Path } from "react-native-svg";
import {
  Image,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View
} from "react-native";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import { useTranslation } from "react-i18next";
import Text from "../../components/styled-text";
import { ITunerConfig } from "@/@interfaces";
import { guitarTunings } from "./tunings";
import palette from "../../theme/palette";

const Buttons = ({
  config,
  setConfig,
  tuning,
  onOpenTuning,
  onReady,
  onError,
  compact = false,
  compactControls = false,
  spectrum = false,
  referencePlaying = false,
  onVisualization,
  onCalibration,
  onReference
}: {
  config: ITunerConfig;
  setConfig: Dispatch<SetStateAction<ITunerConfig>>;
  tuning: string;
  onOpenTuning: () => void;
  onReady?: () => void;
  onError?: () => void;
  compact?: boolean;
  compactControls?: boolean;
  spectrum?: boolean;
  referencePlaying?: boolean;
  onVisualization?: () => void;
  onCalibration?: () => void;
  onReference?: () => void;
}) => {
  const { selectedInstrument, autoDetect } = config;
  const { width } = useWindowDimensions();
  const { t } = useTranslation();
  useEffect(() => {
    if (selectedInstrument === "chromatic") onReady?.();
  }, [selectedInstrument, onReady]);
  const buttonWidth = compact ? 86 : Math.min(92, Math.max(72, width * 0.22));
  const buttonHeight = (buttonWidth * 2) / 3;
  const fontSize = buttonWidth * 0.135;
  const nextInstrument =
    selectedInstrument === "guitar" ? "chromatic" : "guitar";
  const buttons = [
    {
      key: "instrument",
      icon: selectedInstrument === "guitar" ? "guitar-acoustic" : "sine-wave",
      label: t(selectedInstrument),
      value: "",
      color: "#FFE4A0",
      accessibilityLabel: `${t("SwitchTuner")}: ${t(nextInstrument)}`,
      onPress: () =>
        setConfig((prev) => ({
          ...prev,
          selectedInstrument:
            prev.selectedInstrument === "guitar" ? "chromatic" : "guitar"
        }))
    },
    ...(selectedInstrument === "guitar"
      ? [
          {
            key: "mode",
            icon: autoDetect ? "waveform" : "hand-back-right-outline",
            label: t("mode"),
            value: t(autoDetect ? "Auto" : "Manual"),
            color: autoDetect ? "#ACFA52" : "#FFD36D",
            accessibilityLabel: `${t("mode")}: ${t(autoDetect ? "Auto" : "Manual")}`,
            onPress: () =>
              setConfig((prev) => ({ ...prev, autoDetect: !prev.autoDetect }))
          },
          {
            key: "tuning",
            icon: "tune-vertical",
            label: t("Tuning"),
            value:
              tuning === "custom"
                ? t("CustomTuning")
                : (guitarTunings[tuning]?.label ??
                  guitarTunings.standard.label),
            color: "#FFE4A0",
            accessibilityLabel: t("GuitarTuning"),
            onPress: onOpenTuning
          }
        ]
      : [])
  ];

  if (selectedInstrument === "chromatic") {
    const controls = [
      {
        icon: "guitar-acoustic",
        selected: false,
        label: `${t("SwitchTuner")}: ${t("guitar")}`,
        onPress: buttons[0].onPress
      },
      {
        icon: spectrum ? "chart-bar" : "sine-wave",
        selected: spectrum,
        label: t(spectrum ? "SignalWaveform" : "SignalSpectrum"),
        onPress: onVisualization
      },
      {
        icon: "tuning-fork",
        selected: false,
        label: t("TunerCalibration"),
        onPress: onCalibration
      },
      {
        icon: referencePlaying ? "volume-off" : "volume-high",
        selected: referencePlaying,
        label: t(referencePlaying ? "StopReferenceNote" : "PlayReferenceNote"),
        onPress: onReference
      }
    ];
    return (
      <View
        pointerEvents="box-none"
        style={
          compactControls ? styles.compactChromatic : StyleSheet.absoluteFillObject
        }
      >
        {controls.map((control, index) => (
          <Pressable
            key={control.label}
            accessibilityRole="button"
            accessibilityLabel={control.label}
            accessibilityState={{ selected: control.selected }}
            onPress={control.onPress}
            style={({ pressed }) => [
              styles.round,
              compactControls
                ? styles.flowRound
                : index === 0
                  ? { left: 12, top: 12 }
                  : { right: 12, top: 12 + (index - 1) * 52 },
              pressed && styles.pressed
            ]}
          >
            <LinearGradient
              colors={palette.finish.goldColors}
              locations={palette.finish.locations}
              style={styles.roundRim}
            >
              <LinearGradient
                colors={
                  control.selected
                    ? palette.finish.goldColors
                    : palette.chromatic.controlFace
                }
                locations={
                  control.selected ? palette.finish.locations : undefined
                }
                style={styles.roundFace}
              >
                {control.icon === "tuning-fork" ? (
                  <Svg width={23} height={23} viewBox="0 0 24 24">
                    <Path
                      d="M7 3v7a5 5 0 0 0 10 0V3 M12 15v6 M9 21h6 M5 5h4 M15 5h4"
                      fill="none"
                      stroke={palette.gold.top}
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                ) : (
                  <MaterialCommunityIcons
                    name={control.icon}
                    size={23}
                    color={
                      control.selected ? palette.gold.ink : palette.gold.top
                    }
                  />
                )}
              </LinearGradient>
            </LinearGradient>
          </Pressable>
        ))}
      </View>
    );
  }
  return (
    <View
      pointerEvents="box-none"
      style={[styles.container, compact && styles.compact]}
    >
      {buttons.map((button, index) => (
        <Pressable
          key={button.key}
          accessibilityRole="button"
          accessibilityLabel={button.accessibilityLabel}
          onPress={button.onPress}
          style={({ pressed }) => [
            styles.button,
            { width: buttonWidth, height: buttonHeight },
            pressed && styles.pressed
          ]}
        >
          <Image
            source={require("../../../assets/images/tuner-button-wood.webp")}
            accessible={false}
            style={[
              StyleSheet.absoluteFillObject,
              { width: buttonWidth, height: buttonHeight }
            ]}
            resizeMode="stretch"
            onLoad={index === 0 ? onReady : undefined}
            onError={onError}
          />
          <MaterialCommunityIcons
            name={button.icon}
            size={buttonWidth * (button.value ? 0.22 : 0.32)}
            color={button.color}
            style={[
              styles.icon,
              {
                textShadowColor: button.color,
                lineHeight: buttonWidth * (button.value ? 0.24 : 0.34)
              }
            ]}
          />
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={[
              styles.label,
              {
                fontSize: button.value ? fontSize * 0.8 : fontSize,
                lineHeight: fontSize * (button.value ? 0.92 : 1.15)
              }
            ]}
          >
            {button.label.toUpperCase()}
          </Text>
          {!!button.value && (
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={[
                styles.value,
                { fontSize, lineHeight: fontSize * 1.15, color: button.color }
              ]}
            >
              {button.key === "mode"
                ? button.value.toUpperCase()
                : button.value}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
};
const styles = StyleSheet.create({
  round: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    shadowColor: palette.gold.glow,
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5
  },
  compactChromatic: {
    position: "absolute",
    left: 8,
    right: 8,
    top: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  flowRound: { position: "relative" },
  roundRim: { flex: 1, padding: 1, borderRadius: 22 },
  roundFace: {
    flex: 1,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center"
  },
  container: {
    position: "absolute",
    top: 80,
    right: 3,
    gap: 8,
    alignItems: "center",
    zIndex: 9
  },
  compact: { top: 0, right: 0, gap: 7 },
  button: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  icon: {
    includeFontPadding: false,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3
  },
  label: {
    includeFontPadding: false,
    color: palette.gold.top,
    fontWeight: "600",
    textAlign: "center",
    textShadowColor: palette.gold.ink,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1
  },
  value: {
    includeFontPadding: false,
    fontWeight: "600",
    textAlign: "center"
  }
});
export default Buttons;
