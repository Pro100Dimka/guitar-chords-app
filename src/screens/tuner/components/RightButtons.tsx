import { Instrument } from "../instruments";
import { getTuningFreq, useConfigStore } from "@/stores/configStore";
import { Feather, FontAwesome5, Ionicons } from "@expo/vector-icons";
import {
  Linking,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import Colors from "../colors";
import Dropdown from "@/components/fields/dropdown";
import ChromaticIcon from "../icons/chromatic";
import palette from "@/theme/palette";
import GuitarIcon from "../icons/guitar";
import { InstrumentType, TuningType } from "@/@types";

export const RightButtons = ({
  instrument
}: {
  positionY: number;
  instrument: Instrument;
}) => {
  const { height, width } = useWindowDimensions();
  const manual = useConfigStore((state) => state.manual);
  const setManual = useConfigStore((state) => state.setManual);
  const setInstrument = useConfigStore((state) => state.setInstrument);
  const setTuning = useConfigStore((state) => state.setTuning);
  const tuning = useConfigStore((state) => state.tuning);
  const { t } = useTranslation();
  const btnW = width / 7;
  const fontHeight = height / 70;
  const fontSize = fontHeight / 1.3;
  const btnBorder = 1;

  const instruments: any[] = useMemo(() => {
    const subactions = [
      { value: "chromatic", Icon: ChromaticIcon },
      { value: "guitar", Icon: GuitarIcon }
    ].map(({ Icon, ...item }) => ({
      ...item,
      label: <Icon fill={palette.colors.accent} />
    }));
    // Avoid nested menus in android (collapsed by default)
    return Platform.OS === "android"
      ? subactions
      : [
          {
            id: "instrument",
            title: t("mode"),
            subactions
          }
        ];
  }, [t]);

  const tunings: any[] = useMemo(() => {
    const subactions = [
      { value: "ref_440", label: t("tuning_440") },
      { value: "ref_432", label: t("tuning_432") },
      { value: "ref_444", label: t("tuning_444") }
    ];
    // Avoid nested menus in android (collapsed by default)
    return Platform.OS === "android"
      ? subactions
      : [
          {
            id: "tuning-type",
            title: t("reference_a4"),
            displayInline: true,
            subactions
          }
        ];
  }, [t]);

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        width: "100%",
        justifyContent: "space-between",
        flexDirection: "row"
      }}
    >
      <View style={{ paddingHorizontal: 10 }}>
        <Dropdown
          options={tunings}
          value={tuning}
          style={{
            container: { width: "auto" },
            optionText: { textAlign: "center" }
          }}
          onSelect={(value) => setTuning(value as TuningType)}
        />
      </View>
      <View style={{ paddingHorizontal: 10 }}>
        <Dropdown
          options={instruments}
          value={instrument.name}
          style={{ container: { width: "auto" }, picker: { padding: 5 } }}
          onSelect={(value) => setInstrument(value as InstrumentType)}
        />
        {instrument.hasStrings && (
          <Pressable
            onPress={() => setManual(!manual)}
            style={{
              marginLeft: 5,
              width: btnW,
              borderRadius: 10,
              backgroundColor: manual ? Colors.bgActive : Colors.secondary,
              borderColor: manual ? Colors.secondary : Colors.accent,
              borderWidth: btnBorder,
              justifyContent: "center",
              paddingVertical: 10,
              gap: 3
            }}
          >
            <Text
              style={{
                color: Colors.primary,
                fontSize: fontSize * 0.8,
                textAlign: "center"
              }}
            >
              {t("gtr_string")}
            </Text>
            <Text
              style={{
                color: manual ? Colors.warn : Colors.ok,
                fontSize: fontSize,
                textAlign: "center",
                fontWeight: "600"
              }}
            >
              {manual ? "MANUAL" : "AUTO"}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};
