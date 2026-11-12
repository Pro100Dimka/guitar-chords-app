import React, { useEffect, useState } from "react";
import { Alert, Linking, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import Text from "../../components/styled-text";
import {
  AnalysisSettings,
  defaultAnalysisSettings,
  loadAnalysisSettings,
  analysisServerUrl,
  startSongAnalysis
} from "../../components/song-analysis/client";
import { analysisErrorKey } from "../../components/song-analysis/errors";
import { Action, Sheet } from "./tools";
import styles from "./audio-styles";
import palette from "../../theme/palette";

export default function AnalysisSettingsSheet({
  songId,
  onClose
}: {
  songId: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<AnalysisSettings>(defaultAnalysisSettings);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    loadAnalysisSettings()
      .then((settings) => {
        if (active) setValue(settings);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const start = () => {
    let url: string;
    try {
      url = analysisServerUrl(value.url);
    } catch (error) {
      Alert.alert(t(analysisErrorKey(error)));
      return;
    }
    Alert.alert(
      t("AnalysisUploadTitle"),
      t("AnalysisUploadConsent", { server: url }),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("AnalysisSend"),
          onPress: () => {
            onClose();
            void startSongAnalysis(songId, { ...value, url }).catch((error) =>
              Alert.alert(t(analysisErrorKey(error)))
            );
          }
        }
      ]
    );
  };
  return (
    <Sheet musical title={t("AnalysisSetup")} onClose={onClose}>
      <Text style={styles.text}>{t("AnalysisServerHint")}</Text>
      <Text style={styles.muted}>{t("AnalysisServerAddress")}</Text>
      <TextInput
        accessibilityLabel={t("AnalysisServerAddress")}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="http://192.168.1.10:8765"
        placeholderTextColor={palette.glass.muted}
        value={value.url}
        onChangeText={(url) => setValue({ ...value, url })}
      />
      <Text style={styles.muted}>{t("AnalysisServerToken")}</Text>
      <TextInput
        accessibilityLabel={t("AnalysisServerToken")}
        style={styles.input}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        value={value.token}
        onChangeText={(token) => setValue({ ...value, token })}
      />
      <Text style={styles.muted}>{t("AnalysisLanguage")}</Text>
      <View style={styles.row}>
        {(["auto", "uk", "ru", "en"] as const).map((language) => (
          <Action
            key={language}
            glass
            compact
            label={
              language === "auto"
                ? t("AnalysisAutoLanguage")
                : { uk: "Українська", ru: "Русский", en: "English" }[language]
            }
            selected={value.language === language}
            onPress={() => setValue({ ...value, language })}
          />
        ))}
      </View>
      <Text style={styles.muted}>{t("AnalysisQualityHint")}</Text>
      {value.url.startsWith("http:") && (
        <Text style={styles.error}>{t("AnalysisHttpHint")}</Text>
      )}
      <Action
        glass
        label={t("AnalysisSetupGuide")}
        onPress={() => {
          void Linking.openURL(
            "https://github.com/Pro100Dimka/guitar-chords-app/blob/feature/audio-song-analysis/backend/README.md"
          ).catch(() => Alert.alert(t("LinkOpenError")));
        }}
      />
      <Action
        primary
        label={t("AnalysisStart")}
        disabled={loading || !value.url.trim()}
        onPress={start}
      />
      <Action glass label={t("Cancel")} onPress={onClose} />
    </Sheet>
  );
}
