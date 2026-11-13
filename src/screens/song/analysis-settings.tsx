import React, { useEffect, useState } from "react";
import { Alert, Linking, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import Text from "../../components/styled-text";
import {
  AnalysisSettings,
  defaultAnalysisSettings,
  loadAnalysisSettings,
  analysisDestination,
  analysisMode,
  inspectAnalysisService,
  startSongAnalysis
} from "../../components/song-analysis/client";
import {
  ServiceHealth,
  saveAnalysisPreferences
} from "../../components/song-analysis/service-config";
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
  const [advanced, setAdvanced] = useState(false);
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [serviceError, setServiceError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    loadAnalysisSettings()
      .then((settings) => {
        if (active) setValue(settings);
      })
      .catch(() => {
        if (active) setServiceError("AnalysisSettingsReadError");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const mode = analysisMode(value);
  let destination = "";
  try {
    destination = analysisDestination(value);
  } catch {
    /* An empty bundled URL deliberately disables shared analysis. */
  }
  const token = mode === "private" ? value.token : "";
  useEffect(() => {
    const controller = new AbortController();
    setHealth(null);
    if (loading || !destination) {
      setChecking(false);
      return () => controller.abort();
    }
    setChecking(true);
    setServiceError("");
    void inspectAnalysisService(
      { mode, url: destination, token, language: "auto" },
      controller.signal
    )
      .then((status) => {
        if (!controller.signal.aborted) {
          setHealth(status);
          if (!status.ready) setServiceError("AnalysisServiceNotReady");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setServiceError(analysisErrorKey(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [destination, token, mode, loading, refresh]);
  const close = () => {
    void saveAnalysisPreferences(value).catch(() => {});
    onClose();
  };
  const start = () => {
    if (loading || checking || !destination || !health?.ready || serviceError)
      return;
    const consent =
      mode === "shared"
        ? t("AnalysisSharedUploadConsent", {
            server: destination,
            hours: health.privacy?.resultRetentionHours ?? 24
          })
        : t("AnalysisUploadConsent", { server: destination });
    Alert.alert(t("AnalysisUploadTitle"), consent, [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("AnalysisSend"),
        onPress: () => {
          onClose();
          void startSongAnalysis(songId, value).catch((error) =>
            Alert.alert(t(analysisErrorKey(error)))
          );
        }
      }
    ]);
  };
  return (
    <Sheet musical title={t("AnalysisSetup")} onClose={close}>
      <Text style={styles.text}>
        {t(mode === "shared" ? "AnalysisSharedHint" : "AnalysisPrivateActive")}
      </Text>
      {destination ? (
        <>
          <Text style={styles.muted}>{t("AnalysisDestination")}</Text>
          <Text style={styles.text} selectable>
            {destination}
          </Text>
        </>
      ) : (
        <Text style={styles.error}>
          {t(
            mode === "shared"
              ? "AnalysisServiceUnavailable"
              : "AnalysisPrivateAddressNeeded"
          )}
        </Text>
      )}
      {checking && (
        <Text style={styles.muted}>{t("AnalysisCheckingService")}</Text>
      )}
      {!!serviceError && !!destination && (
        <>
          <Text style={styles.error}>{t(serviceError)}</Text>
          <Action
            glass
            label={t("Retry")}
            onPress={() => setRefresh(refresh + 1)}
          />
        </>
      )}
      {health?.ready && (
        <Text style={styles.muted}>{t("AnalysisServiceReady")}</Text>
      )}
      {health?.limits && (
        <Text style={styles.muted}>
          {t("AnalysisServiceLimits", {
            megabytes: Number(
              (health.limits.uploadBytes / (1024 * 1024)).toFixed(2)
            ),
            minutes: Number((health.limits.durationSeconds / 60).toFixed(2)),
            active: health.limits.activeJobsPerInstallation,
            daily: health.limits.jobsPerDay
          })}
        </Text>
      )}
      <Text style={styles.muted}>
        {t(
          mode === "shared"
            ? "AnalysisSharedPrivacy"
            : "AnalysisPrivatePrivacy",
          {
            hours: health?.privacy?.resultRetentionHours ?? 24
          }
        )}
      </Text>
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
      <Action
        glass
        label={t("AnalysisAdvancedSettings")}
        selected={advanced}
        onPress={() => setAdvanced(!advanced)}
      />
      {advanced && (
        <>
          <Text style={styles.muted}>{t("AnalysisAdvancedHint")}</Text>
          <View style={styles.row}>
            <Action
              glass
              compact
              label={t("AnalysisSharedService")}
              selected={mode === "shared"}
              onPress={() => setValue({ ...value, mode: "shared" })}
            />
            <Action
              glass
              compact
              label={t("AnalysisPrivateService")}
              selected={mode === "private"}
              onPress={() => setValue({ ...value, mode: "private" })}
            />
          </View>
          {mode === "private" && (
            <>
              <Text style={styles.muted}>{t("AnalysisServerAddress")}</Text>
              <TextInput
                accessibilityLabel={t("AnalysisServerAddress")}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://"
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
                onChangeText={(accessToken) =>
                  setValue({ ...value, token: accessToken })
                }
              />
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
            </>
          )}
        </>
      )}
      <Action
        primary
        label={t("AnalysisStart")}
        disabled={
          loading ||
          checking ||
          !destination ||
          !health?.ready ||
          !!serviceError
        }
        onPress={start}
      />
      <Action glass label={t("Cancel")} onPress={close} />
    </Sheet>
  );
}
