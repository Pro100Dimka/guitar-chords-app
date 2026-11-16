import {
  Alert,
  Image,
  Pressable,
  Linking,
  ScrollView,
  StyleSheet,
  TextInput,
  Keyboard,
  View,
  useWindowDimensions
} from "react-native";
import Text from "../components/styled-text";
import LinearGradient from "react-native-linear-gradient";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { changeLanguage, langs, languages } from "../locales";
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
  const operation = useRef<{ controller?: AbortController } | null>(null);
  useEffect(
    () => () => {
      operation.current?.controller?.abort();
      operation.current = null;
    },
    []
  );
  const [pending, setPending] = useState<ReturnType<
    typeof parseLibraryBackup
  > | null>(null);
  const fileAction = async (
    action: (signal?: AbortSignal) => Promise<void>,
    cancelable = false
  ) => {
    if (operation.current) return;
    const task = { controller: cancelable ? new AbortController() : undefined };
    operation.current = task;
    setBusy(true);
    try {
      await action(task.controller?.signal);
    } catch (error) {
      if (operation.current === task && !fileCanceled(error))
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
      if (operation.current === task) {
        operation.current = null;
        setBusy(false);
      }
    }
  };
  const [privacy, setPrivacy] = useState(false);
  const [audioCredits, setAudioCredits] = useState(false);
  const [language, setLanguage] = useState(false);
  const [languageQuery, setLanguageQuery] = useState("");
  const [showPlanned, setShowPlanned] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const search = languageQuery
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
  const filteredLanguages = !search
    ? languages
    : languages.filter((item) =>
        [
          item.code,
          item.code === "ua" ? "uk" : item.code,
          item.native,
          ...Object.values(item.names)
        ]
          .join(" ")
          .toLowerCase()
          .normalize("NFKD")
          .replace(/\p{M}/gu, "")
          .includes(search)
      );
  const availableLanguages = filteredLanguages.filter((item) =>
    langs.includes(item.code)
  );
  const plannedLanguages = filteredLanguages.filter(
    (item) => !langs.includes(item.code)
  );
  const languageRow = (
    item: (typeof languages)[number],
    available: boolean
  ) => {
    const names: Record<string, string> = item.names;
    const name = names[i18n.language] ?? names.en;
    return (
      <Pressable
        key={item.code}
        accessibilityRole="button"
        accessibilityLabel={`${item.native}, ${name}${available ? "" : `, ${t("LanguagePending")}`}`}
        accessibilityState={{
          selected: i18n.language === item.code,
          disabled: !available || savingLanguage
        }}
        disabled={!available || savingLanguage}
        style={({ pressed }) => [styles.languageRow, pressed && styles.pressed]}
        onPress={async () => {
          setSavingLanguage(true);
          try {
            await changeLanguage(item.code);
            Keyboard.dismiss();
            setLanguage(false);
          } catch {
            Alert.alert(t("ErrorSavingItem"));
          } finally {
            setSavingLanguage(false);
          }
        }}
      >
        <View style={styles.languageWords}>
          <Text style={styles.languageName}>{item.native}</Text>
          <Text style={styles.languageHint}>
            {name}
            {!available && ` · ${t("LanguagePending")}`}
          </Text>
        </View>
        <MaterialCommunityIcons
          name={
            available
              ? i18n.language === item.code
                ? "check-circle"
                : "circle-outline"
              : "clock-outline"
          }
          size={22}
          color={available ? palette.glass.accent : palette.glass.muted}
        />
      </Pressable>
    );
  };
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
            onPress: () => {
              setLanguageQuery("");
              setShowPlanned(false);
              setLanguage(true);
            }
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
              colors={["rgba(255,255,255,0.06)", "rgba(255,255,255,0)"]}
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
          <View style={styles.languageSearch}>
            <MaterialCommunityIcons
              name="magnify"
              size={23}
              color={palette.glass.accent}
            />
            <TextInput
              value={languageQuery}
              onChangeText={setLanguageQuery}
              placeholder={t("LanguageSearch")}
              accessibilityLabel={t("LanguageSearch")}
              placeholderTextColor={palette.glass.muted}
              underlineColorAndroid="transparent"
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={Keyboard.dismiss}
              style={styles.languageInput}
            />
            {!!languageQuery && (
              <Pressable
                onPress={() => setLanguageQuery("")}
                accessibilityRole="button"
                accessibilityLabel={t("ClearSearch")}
                style={styles.languageClear}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={21}
                  color={palette.glass.muted}
                />
              </Pressable>
            )}
          </View>

          {!!availableLanguages.length && (
            <Text style={styles.languageSection}>{t("LanguageAvailable")}</Text>
          )}
          {availableLanguages.map((item) => languageRow(item, true))}
          {!!plannedLanguages.length && (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  expanded: showPlanned || !!search,
                  disabled: !!search
                }}
                disabled={!!search}
                onPress={() => setShowPlanned(!showPlanned)}
                style={styles.languageRow}
              >
                <Text style={styles.languageSection}>
                  {t("LanguagePlanned")} · {plannedLanguages.length}
                </Text>
                <MaterialCommunityIcons
                  name={showPlanned || search ? "chevron-up" : "chevron-down"}
                  size={22}
                  color={palette.glass.accent}
                />
              </Pressable>
              {(showPlanned || !!search) && (
                <>
                  <Text style={styles.body}>{t("LanguagePlannedHint")}</Text>
                  {plannedLanguages.map((item) => languageRow(item, false))}
                </>
              )}
            </>
          )}
          {!filteredLanguages.length && (
            <Text style={styles.body}>{t("LanguageNoResults")}</Text>
          )}
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
            if (busy && !operation.current?.controller) return;
            operation.current?.controller?.abort();
            operation.current = null;
            setBusy(false);
            setBackup(false);
            setPending(null);
          }}
        >
          <Image
            source={
              pending
                ? require("../../assets/images/gold-restore.webp")
                : require("../../assets/images/gold-cloud.webp")
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
                  void fileAction(async (signal) => {
                    const file = await readLibraryFile("backup", signal);
                    if (!signal?.aborted)
                      setPending(parseLibraryBackup(file.text));
                  }, true)
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
            label={t("RecordedGuitar")}
            onPress={() => {
              void Linking.openURL(
                "https://github.com/Pro100Dimka/guitar-chords-app#sound-bank"
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
            source={require("../../assets/images/gold-shield.webp")}
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
  languageSearch: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    backgroundColor: palette.glass.surface
  },
  languageInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    color: palette.glass.ink,
    fontFamily: palette.typography.body,
    fontSize: 16,
    backgroundColor: palette.colors.transparent,
    borderWidth: 0
  },
  languageClear: {
    width: 44,
    height: 48,
    alignItems: "center",
    justifyContent: "center"
  },
  languageRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 14,
    minHeight: 60,
    borderBottomWidth: 1,
    borderColor: palette.glass.surfaceEdge
  },
  languageWords: { flex: 1, gap: 4 },
  languageName: { fontSize: 17, lineHeight: 25, color: palette.glass.ink },
  languageHint: { fontSize: 13, lineHeight: 20, color: palette.glass.muted },
  languageSection: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "600",
    color: palette.glass.accent,
    flexShrink: 1
  },
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
