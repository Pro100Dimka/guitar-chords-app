import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import Dropdown from "../components/fields/dropdown";
import { changeLanguage, langs } from "./index";

const LocaleButton = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || "ua";
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (i18n.isInitialized) setLoaded(true);
  }, [i18n.isInitialized]);
  if (!loaded) return null;

  return (
    <View style={styles.container}>
      <Dropdown
        options={langs.map((lng) => ({ label: t(lng), value: lng }))}
        value={lang}
        onSelect={changeLanguage}
      />
    </View>
  );
};
const styles = StyleSheet.create({
  container: { alignItems: "center", width: "100%", flex: 1, marginTop: 20 }
});

export default LocaleButton;
