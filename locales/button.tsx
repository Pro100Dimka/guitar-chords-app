import { Picker } from "@react-native-picker/picker";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { changeLanguage, langs } from "./index";

const LocaleButton = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || "ua";
  return (
    <View style={styles.pickerContainer}>
      <Picker
        selectedValue={lang}
        onValueChange={changeLanguage}
        style={styles.picker}
      >
        {langs.map((item) => (
          <Picker.Item key={item} label={t(item)} value={item} />
        ))}
      </Picker>
    </View>
  );
};
const styles = StyleSheet.create({
  background: { flex: 1 },
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    backgroundColor: "rgba(255, 255, 255, 0.5)",
    paddingHorizontal: 20
  },
  text: {
    fontSize: 16,
    color: "#000",
    textAlign: "center",
    marginVertical: 4
  },
  pickerContainer: {
    marginTop: 20,
    width: 200,
    borderWidth: 1,
    borderColor: "#888",
    borderRadius: 8,
    backgroundColor: "#fff"
  },
  picker: { width: "100%" }
});
export default LocaleButton;
