import * as i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import ru from "./ru.json";
import ua from "./ua.json";
import { zustandStorage } from "@/stores/localStorage";

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

export const changeLanguage = (lng: string) => {
  zustandStorage.setItem("language", lng);
  i18n.changeLanguage(lng);
};
export const initLanguage = async () => {
  try {
    const lng = await zustandStorage.getItem("language");
    if (lng) await i18n.changeLanguage(lng);
  } catch (e) {
    console.info("Error loading language:", e);
  }
};

export const { t } = i18n;
export default i18n;
