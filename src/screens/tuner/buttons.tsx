import React from "react";
import { useWindowDimensions, Pressable, StyleSheet, View } from "react-native";
import Text from "../../components/styled-text";
import { Dispatch, SetStateAction, useMemo } from "react";
import { useTranslation } from "react-i18next";
import palette from "@/theme/palette";
import Dropdown from "@/components/fields/dropdown";
import { ITunerConfig } from "@/@interfaces";
const Buttons = ({
  config,
  setConfig,
  onOpenTuning,
  compact = false
}: {
  config: ITunerConfig;
  setConfig: Dispatch<SetStateAction<ITunerConfig>>;
  onOpenTuning: () => void;
  compact?: boolean;
}) => {
  const { instruments, selectedInstrument, autoDetect } = config;
  const { height } = useWindowDimensions();
  const { t } = useTranslation();
  const fontHeight = height / 68;
  const fontSize = Math.min(16, Math.max(12, fontHeight / 1.3));
  const instrOptions = useMemo(() => {
    const subactions = Object.entries(instruments).map(([value, { Icon }]) => ({
      value,
      label: <Icon fill={palette.colors.accent} height={45} width={45} />
    }));
    return subactions;
  }, [instruments]);

  return (
    <View style={[styles.container, compact && styles.compact]}>
      <View style={styles.sight}>
        <Dropdown
          options={instrOptions}
          value={selectedInstrument}
          style={{
            container: { width: "auto" },
            picker: { padding: 0 },
            option: { padding: 0 },
            optionText: { textAlign: "center" }
          }}
          onSelect={(val) =>
            setConfig((prev) => ({ ...prev, selectedInstrument: val }))
          }
        />
      </View>
      {selectedInstrument === "guitar" && (
        <>
          <View style={styles.sight}>
            {instruments[selectedInstrument].stringNotes && (
              <Pressable
                onPress={() =>
                  setConfig((prev) => ({
                    ...prev,
                    autoDetect: !prev.autoDetect
                  }))
                }
                style={[
                  styles.detect,
                  { backgroundColor: palette.colors.blackOpacity }
                ]}
              >
                <Text style={[styles.detectStr, { fontSize }]}>{t`mode`}</Text>
                <Text
                  style={[
                    styles.detectAuto,
                    {
                      color: !autoDetect
                        ? palette.colors.warn
                        : palette.colors.ok,
                      fontSize: fontSize
                    }
                  ]}
                >
                  {(autoDetect ? t`Auto` : t`Manual`).toUpperCase()}
                </Text>
              </Pressable>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={onOpenTuning}
            style={[styles.detect, styles.tuningButton]}
          >
            <Text style={[styles.detectStr, { fontSize }]}>
              {t("GuitarTuning")}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
};
const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 80,
    gap: 10,
    right: 0,
    flexDirection: "column",
    zIndex: 9
  },
  tuningButton: {
    maxWidth: 70,
    minHeight: 44,
    backgroundColor: palette.colors.blackOpacity
  },
  compact: {
    top: 12,
    right: 0,
    flexDirection: "column",
    alignItems: "center",
    gap: 8
  },
  sight: { paddingHorizontal: 5, gap: 10 },
  detect: {
    borderRadius: 10,
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 5,
    gap: 4
  },
  detectStr: { color: palette.colors.primary, textAlign: "center" },
  detectAuto: { textAlign: "center", fontWeight: 600 }
});
export default Buttons;
