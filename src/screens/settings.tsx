import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import React from "react";
import { useTranslation } from "react-i18next";
import { changeLanguage, langs } from "../locales";
import { Action } from "./song/tools";
import palette from "../theme/palette";
const Settings: React.FC = () => {
  const { t, i18n } = useTranslation();
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{t("language")}</Text>
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
            }}
          />
        ))}
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>{t("LocalLibrary")}</Text>
        <Text style={styles.body}>{t("LocalLibraryHint")}</Text>
      </View>
    </ScrollView>
  );
};
const styles = StyleSheet.create({
  container: { padding: 20, gap: 20 },
  card: {
    padding: 20,
    gap: 14,
    borderRadius: 24,
    backgroundColor: palette.glass.surface,
    borderWidth: 1,
    borderColor: palette.glass.edge
  },
  title: { color: palette.glass.ink, fontSize: 21, fontWeight: "600" },
  body: { color: palette.glass.muted, fontSize: 15, lineHeight: 24 }
});
export default Settings;
