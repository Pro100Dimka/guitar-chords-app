import {
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import { Dispatch, SetStateAction, useMemo } from "react";
import { useTranslation } from "react-i18next";
import palette from "@/theme/palette";
import Dropdown from "@/components/fields/dropdown";
import { ITunerConfig } from "@/@interfaces";
const Buttons = ({
  config,
  setConfig,
  onOpenTuning
}: {
  config: ITunerConfig;
  setConfig: Dispatch<SetStateAction<ITunerConfig>>;
  onOpenTuning: () => void;
}) => {
  const { instruments, selectedInstrument, autoDetect } = config;
  const { height } = Dimensions.get("window");
  const { t } = useTranslation();
  const fontHeight = height / 68;
  const fontSize = Math.max(12, fontHeight / 1.3);
  const instrOptions: any[] = useMemo(() => {
    const subactions = (
      Object.entries(instruments) as [
        keyof typeof instruments,
        (typeof instruments)[keyof typeof instruments]
      ][]
    ).map(([value, { Icon }]) => ({
      value,
      label: <Icon fill={palette.colors.accent} height={45} width={45} />
    }));
    return Platform.OS === "android"
      ? subactions
      : [{ id: "instrument", title: t`mode`, subactions }];
  }, [instruments, t]);

  if (selectedInstrument === "guitar")
    return (
      <View style={styles.container}>
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
        <View style={styles.sight}>
          {instruments[selectedInstrument].stringNotes && (
            <Pressable
              onPress={() =>
                setConfig((prev) => ({ ...prev, autoDetect: !prev.autoDetect }))
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
      </View>
    );
  return (
    <View style={styles.instrumentBar}>
      {["guitar", "chromatic"].map((instrument) => (
        <Pressable
          key={instrument}
          accessibilityRole="button"
          accessibilityState={{
            selected: config.selectedInstrument === instrument
          }}
          onPress={() =>
            setConfig((previous) => ({
              ...previous,
              selectedInstrument: instrument
            }))
          }
          style={({ pressed }) => [
            styles.instrumentButton,
            config.selectedInstrument === instrument && styles.selected,
            pressed && styles.pressed
          ]}
        >
          <Text
            style={[
              styles.label,
              config.selectedInstrument === instrument && styles.selectedLabel
            ]}
          >
            {t(instrument)}
          </Text>
        </Pressable>
      ))}
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
  sight: { paddingHorizontal: 5, gap: 10 },
  detect: {
    borderRadius: 10,
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 5,
    gap: 4
  },
  detectStr: { color: palette.colors.primary, textAlign: "center" },
  detectAuto: { textAlign: "center", fontWeight: 600 },
  instrumentBar: {
    position: "absolute",
    top: 16,
    left: 20,
    right: 20,
    flexDirection: "row",
    padding: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.chromatic.border,
    backgroundColor: palette.chromatic.panel
  },
  instrumentButton: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 11,
    paddingHorizontal: 8
  },
  selected: { backgroundColor: palette.chromatic.selected },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: palette.chromatic.secondary
  },
  selectedLabel: { color: palette.chromatic.ink },
  pressed: { opacity: 0.75 }
});
export default Buttons;
