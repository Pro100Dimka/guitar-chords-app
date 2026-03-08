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
interface ITunerBtnProps {
  config: ITunerConfig;
  setConfig: Dispatch<SetStateAction<ITunerConfig>>;
}
const Buttons = ({ config, setConfig }: ITunerBtnProps) => {
  const {
    instruments,
    tunings,
    selectedInstrument,
    selectedTuning,
    autoDetect
  } = config;

  const { height } = Dimensions.get("window");
  const { t } = useTranslation();
  const fontHeight = height / 68;
  const fontSize = fontHeight / 1.3;
  const btnBorder = 1;
  const instrOptions: any[] = useMemo(() => {
    const subactions = (
      Object.entries(instruments) as [
        keyof typeof instruments,
        (typeof instruments)[keyof typeof instruments]
      ][]
    ).map(([value, { Icon }]) => ({
      value,
      label: <Icon fill={palette.colors.accent} height={60} width={60} />
    }));
    return Platform.OS === "android"
      ? subactions
      : [{ id: "instrument", title: t`mode`, subactions }];
  }, [instruments, t]);

  const tuningOptions: any[] = useMemo(() => {
    const subactions = tunings.map((value) => ({ value, label: t(value) }));
    return Platform.OS === "android"
      ? subactions
      : [{ id: "tuning-type", title: t`refA4`, subactions }];
  }, [t, tunings]);

  return (
    <View style={styles.container}>
      <View style={styles.sight}>
        <Dropdown
          options={tuningOptions}
          value={selectedTuning}
          onSelect={(val) =>
            setConfig((prev) => ({ ...prev, selectedTuning: val }))
          }
          style={{
            container: { width: "auto" },
            optionText: { textAlign: "center" }
          }}
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
              {
                backgroundColor: !autoDetect
                  ? palette.colors.bgActive
                  : palette.colors.secondary,
                borderWidth: btnBorder,
                borderColor: !autoDetect
                  ? palette.colors.secondary
                  : palette.colors.accent
              }
            ]}
          >
            <Text style={[styles.detectStr, { fontSize: fontSize * 1 }]}>
              {t`mode`}
            </Text>
            <Text
              style={[
                styles.detectAuto,
                {
                  color: !autoDetect ? palette.colors.warn : palette.colors.ok,
                  fontSize: fontSize
                }
              ]}
            >
              {(autoDetect ? t`Auto` : t`Manual`).toUpperCase()}
            </Text>
          </Pressable>
        )}
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
    </View>
  );
};
const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    width: "100%",
    justifyContent: "space-between",
    flexDirection: "row",
    zIndex: 9
  },
  sight: { paddingHorizontal: 10, gap: 10 },
  detect: {
    borderRadius: 10,
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 4
  },
  detectStr: { color: palette.colors.primary, textAlign: "center" },
  detectAuto: { textAlign: "center", fontWeight: 600 }
});
export default Buttons;
