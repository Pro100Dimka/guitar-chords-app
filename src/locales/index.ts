import * as i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import ru from "./ru.json";
import ua from "./ua.json";
import { getLocales } from "react-native-localize";
import catalog from "./languages.json";
import {
  createItem,
  getAllItems,
  updateItem
} from "@/components/database/crud";

const resources = {
  en: { translation: en },
  ru: { translation: ru },
  ua: { translation: ua }
};
export const langs = Object.keys(resources);
export const languages = catalog;
const deviceLanguage = () => {
  const code = getLocales()[0]?.languageCode ?? "en";
  const language = code === "uk" ? "ua" : code;
  return langs.includes(language) ? language : "en";
};
export const { t } = i18n;

i18n.use(initReactI18next).init({
  resources,
  lng: deviceLanguage(),
  fallbackLng: "en",
  showSupportNotice: false,
  interpolation: { escapeValue: false }
});

export const changeLanguage = async (lng: string) => {
  if (!langs.includes(lng)) return;
  const existing = await getAllItems({
    tableName: "settings",
    filters: "key = ?",
    parameters: ["language"]
  });

  if (existing.length) {
    await updateItem({
      tableName: "settings",
      data: { value: lng },
      filters: "key = ?",
      parameters: ["language"]
    });
  } else {
    await createItem({
      tableName: "settings",
      data: { key: "language", value: lng }
    });
  }
  await i18n.changeLanguage(lng);
};
export const initLanguage = async () => {
  const [res] = await getAllItems<{ value: string }>({
    tableName: "settings",
    filters: "key = ?",
    parameters: ["language"]
  });
  const saved = res?.value === "uk" ? "ua" : res?.value;
  if (saved && langs.includes(saved)) await i18n.changeLanguage(saved);
  else await changeLanguage(deviceLanguage());
};

export default i18n;
