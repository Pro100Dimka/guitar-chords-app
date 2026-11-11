import React, { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import Text from "../../components/styled-text";
import { useTranslation } from "react-i18next";
import { Action, Sheet } from "../song/tools";
import { usePreferences } from "../../components/preferences";
import palette from "../../theme/palette";
import { guitarTunings, noteLabel } from "./tunings";

export default function TuningSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { tuning, customTuning, tunerSound, update } = usePreferences();
  const [search, setSearch] = useState("");
  const [custom, setCustom] = useState(tuning === "custom");
  const [draft, setDraft] = useState(customTuning);
  return (
    <Sheet musical title={t("GuitarTuning")} onClose={onClose}>
      <Action
        glass
        label={t(tunerSound ? "TuningSoundOn" : "TuningSoundOff")}
        selected={tunerSound}
        onPress={() => update({ tunerSound: !tunerSound })}
      />
      <Action
        glass
        label={t("CustomTuning")}
        selected={custom}
        onPress={() => setCustom(!custom)}
      />
      {custom ? (
        <>
          <Text style={styles.hint}>{t("CustomTuningHint")}</Text>
          {draft.map((note, index) => (
            <View key={index} style={styles.row}>
              <Text style={styles.label}>
                {t("StringNumber", { number: 6 - index })}
              </Text>
              <Action
                glass
                label="−"
                disabled={note <= 28}
                onPress={() =>
                  setDraft(
                    draft.map((value, i) => (i === index ? value - 1 : value))
                  )
                }
              />
              <Text style={styles.note}>{noteLabel(note)}</Text>
              <Action
                glass
                label="+"
                disabled={note >= 88}
                onPress={() =>
                  setDraft(
                    draft.map((value, i) => (i === index ? value + 1 : value))
                  )
                }
              />
            </View>
          ))}
          <Action
            glass
            primary
            label={t("UseTuning")}
            onPress={() => {
              update({ tuning: "custom", customTuning: draft });
              onClose();
            }}
          />
        </>
      ) : (
        <>
          <TextInput
            accessibilityLabel={t("SearchTunings")}
            placeholder={t("SearchTunings")}
            placeholderTextColor={palette.glass.muted}
            value={search}
            onChangeText={setSearch}
            style={styles.search}
            autoCorrect={false}
          />
          {Object.entries(guitarTunings)
            .filter(([, preset]) =>
              preset.label.toLowerCase().includes(search.trim().toLowerCase())
            )
            .map(([key, preset]) => (
              <Action
                glass
                key={key}
                selected={key === tuning}
                label={`${preset.label}\n${preset.notes.map(noteLabel).join(" · ")}`}
                onPress={() => {
                  update({ tuning: key });
                  onClose();
                }}
              />
            ))}
        </>
      )}
      <Text style={styles.hint}>{t("AlternateTuningHint")}</Text>
    </Sheet>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  label: { flex: 1, color: palette.glass.ink, fontSize: 16 },
  note: {
    minWidth: 40,
    textAlign: "center",
    color: palette.glass.ink,
    fontSize: 18,
    fontWeight: "600"
  },
  hint: { color: palette.glass.muted, fontSize: 14, lineHeight: 21 },
  search: {
    fontFamily: palette.typography.body,
    borderRadius: 14,
    padding: 12,
    minHeight: 48,
    backgroundColor: palette.glass.control,
    color: palette.glass.ink,
    borderWidth: 1,
    borderColor: palette.glass.edge
  }
});
