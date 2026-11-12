import {
  Alert,
  Image,
  Pressable,
  Linking,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions
} from "react-native";
import Text from "../components/styled-text";
import LinearGradient from "react-native-linear-gradient";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { changeLanguage, langs } from "../locales";
import { Action, Sheet } from "./song/tools";
import { useSupport } from "../components/support";
import palette from "../theme/palette";
import {
  exportLibrary,
  fileCanceled,
  parseLibraryBackup,
  readLibraryFile,
  restoreLibrary
} from "../components/library-files";
const Settings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { height } = useWindowDimensions();
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ReturnType<
    typeof parseLibraryBackup
  > | null>(null);
  const fileAction = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (!fileCanceled(error))
        Alert.alert(
          t("LibraryFileError"),
          t(
            error instanceof Error &&
              [
                "FileFormatError",
                "FileTooLarge",
                "FileEncodingError",
                "BackupInvalid"
              ].includes(error.message)
              ? error.message
              : "LibraryFileErrorHint"
          )
        );
    } finally {
      setBusy(false);
    }
  };
  const [privacy, setPrivacy] = useState(false);
  const [audioCredits, setAudioCredits] = useState(false);
  const [language, setLanguage] = useState(false);
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("settings")}
      </Text>
      <View style={styles.card}>
        {[
          {
            icon: "translate",
            title: t("language"),
            value: t(i18n.language),
            onPress: () => setLanguage(!language)
          },
          {
            icon: "cloud-upload-outline",
            title: t("LibraryBackup"),
            onPress: () => setBackup(true)
          },
          {
            icon: "heart-outline",
            title: t("SupportDeveloper"),
            onPress: () => useSupport.setState({ visible: true })
          },
          {
            icon: "email-outline",
            title: t("ContactDeveloper"),
            onPress: () => {
              Linking.openURL(
                "mailto:pro100dimka.and@gmail.com?subject=FreeTune"
              ).catch(() =>
                Alert.alert(t("ContactDeveloper"), "pro100dimka.and@gmail.com")
              );
            }
          },
          {
            icon: "music-note-outline",
            title: t("AudioCredits"),
            onPress: () => setAudioCredits(true)
          },
          {
            icon: "shield-lock-outline",
            title: t("PrivacyPolicy"),
            onPress: () => setPrivacy(true)
          }
        ].map((item) => (
          <Pressable
            key={item.icon}
            accessibilityRole="button"
            onPress={item.onPress}
            style={({ pressed }) => [
              styles.settingRow,
              pressed && styles.pressed
            ]}
          >
            <LinearGradient
              pointerEvents="none"
              colors={palette.finish.surfaceColors}
              locations={palette.finish.locations}
              style={styles.rowGradient}
            />
            <MaterialCommunityIcons
              name={item.icon}
              size={24}
              color={palette.glass.accent}
            />
            <Text style={styles.rowLabel}>{item.title}</Text>
            {!!item.value && <Text style={styles.value}>{item.value}</Text>}
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={palette.glass.muted}
            />
          </Pressable>
        ))}
      </View>
      {language && (
        <Sheet musical title={t("language")} onClose={() => setLanguage(false)}>
          {langs.map((lang) => (
            <Action
              glass
              key={lang}
              label={t(lang)}
              selected={i18n.language === lang}
              onPress={() => {
                changeLanguage(lang).catch(() =>
                  Alert.alert(t("ErrorSavingItem"))
                );
                setLanguage(false);
              }}
            />
          ))}
        </Sheet>
      )}
      <Text style={[styles.body, styles.footer]}>
        FreeTune · {t("DeveloperName")}
      </Text>
      {backup && (
        <Sheet
          musical
          title={t("LibraryBackup")}
          onClose={() => {
            if (!busy) {
              setBackup(false);
              setPending(null);
            }
          }}
        >
          <Image
            source={
              pending
                ? require("../../assets/images/gold-restore.png")
                : require("../../assets/images/gold-cloud.png")
            }
            style={[styles.hero, height < 500 && styles.compactHero]}
          />
          <Text style={styles.heroBody}>{t("BackupHint")}</Text>
          {pending ? (
            <>
              <Text style={styles.title}>
                {t("RestorePreview", { count: pending.length })}
              </Text>
              <Text style={styles.body}>{t("RestoreSafeHint")}</Text>
              <Action
                glass
                primary
                label={t(busy ? "FileLoading" : "RestoreConfirm")}
                disabled={busy}
                onPress={() =>
                  void fileAction(async () => {
                    const result = await restoreLibrary(pending);
                    setPending(null);
                    Alert.alert(t("RestoreDone"), t("RestoreResult", result));
                  })
                }
              />
              <Action
                glass
                label={t("Cancel")}
                disabled={busy}
                onPress={() => setPending(null)}
              />
            </>
          ) : (
            <>
              <Action
                glass
                primary
                label={t(busy ? "FileLoading" : "ExportLibrary")}
                disabled={busy}
                onPress={() =>
                  void fileAction(async () => {
                    await exportLibrary();
                    Alert.alert(t("BackupSaved"));
                  })
                }
              />
              <Action
                glass
                label={t("RestoreLibrary")}
                disabled={busy}
                onPress={() =>
                  void fileAction(async () => {
                    const file = await readLibraryFile("backup");
                    setPending(parseLibraryBackup(file.text));
                  })
                }
              />
            </>
          )}
        </Sheet>
      )}
      {audioCredits && (
        <Sheet
          musical
          title={t("AudioCredits")}
          onClose={() => setAudioCredits(false)}
        >
          <Text selectable style={styles.privacyText}>
            {t("ChordRecordingCredits")}
          </Text>
          <Action
            glass
            label="Meta Steel Guitar · CC0"
            onPress={() => {
              void Linking.openURL(
                "https://github.com/facebookincubator/Meta-open-sound/tree/main/systems/instruments/meta-steel-guitar"
              ).catch(() => {});
            }}
          />
        </Sheet>
      )}
      {privacy && (
        <Sheet
          musical
          title={t("PrivacyPolicy")}
          onClose={() => setPrivacy(false)}
        >
          <Image
            source={require("../../assets/images/gold-shield.png")}
            style={styles.privacyIcon}
          />
          <View style={styles.privacyPaper}>
            {t("PrivacyText")
              .split("\n\n")
              .map((paragraph, index) => (
                <Text key={index} selectable style={styles.privacyText}>
                  {paragraph}
                </Text>
              ))}
          </View>
        </Sheet>
      )}
    </ScrollView>
  );
};
const styles = StyleSheet.create({
  privacyIcon: { width: 72, height: 72, alignSelf: "center" },
  privacyPaper: {
    backgroundColor: palette.glass.control,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.glass.surfaceEdge,
    gap: 24
  },
  privacyText: { color: palette.glass.ink, fontSize: 16, lineHeight: 27 },
  footer: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: palette.glass.surface,
    fontSize: 13,
    textAlign: "center"
  },
  rowGradient: { ...StyleSheet.absoluteFillObject, borderRadius: 14 },
  heroBody: {
    color: palette.glass.ink,
    fontSize: 17,
    lineHeight: 26,
    textAlign: "center",
    marginBottom: 8
  },
  compactHero: { width: 90, height: 90, marginTop: 0, marginBottom: 0 },
  hero: {
    alignSelf: "center",
    width: 164,
    height: 164,
    marginTop: 16,
    marginBottom: 10
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    minHeight: 60,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.glass.surfaceEdge
  },
  rowLabel: { flex: 1, color: palette.glass.ink, fontSize: 16, lineHeight: 23 },
  value: { color: palette.glass.accent, fontSize: 14, maxWidth: "30%" },
  container: {
    padding: 20,
    paddingBottom: 40,
    gap: 20,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center"
  },
  heading: { color: palette.glass.ink, fontSize: 28, fontWeight: "600" },
  pressed: { opacity: 0.78 },
  card: {
    gap: 12
  },
  title: { color: palette.glass.ink, fontSize: 21, fontWeight: "600" },
  body: { color: palette.glass.muted, fontSize: 15, lineHeight: 24 }
});
export default Settings;
