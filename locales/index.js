import AsyncStorage from "@react-native-async-storage/async-storage";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.js";
import ru from "./ru.js";
import ua from "./ua.js";

export const langs = ["en", "ru", "ua"];

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ru: { translation: ru },
    ua: { translation: ua }
  },
  lng: "ua",
  fallbackLng: "ua",
  interpolation: { escapeValue: false }
});

export const changeLanguage = (lng) =>
  AsyncStorage.setItem("language", lng).then(() => i18n.changeLanguage(lng));
export const initLanguage = () => {
  AsyncStorage.getItem("language")
    .then((lng) => lng && i18n.changeLanguage(lng))
    .catch(() => {});
};

export const { t } = i18n;
export default i18n;
