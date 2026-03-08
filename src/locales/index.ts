import * as i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import ru from "./ru.json";
import ua from "./ua.json";
import {
  createItem,
  getAllItems,
  updateItem
} from "@/components/database/crud";

export const langs = ["en", "ru", "ua"];
export const { t } = i18n;

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

export const changeLanguage = async (lng: string) => {
  const existing = await getAllItems({
    tableName: "settings",
    filters: `key = "language"`
  });

  if (existing.length) {
    await updateItem({
      tableName: "settings",
      data: { value: lng },
      filters: `key = "language"`
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
  try {
    const [res] = await getAllItems({
      tableName: "settings",
      filters: `key = "language"`
    });
    const lng = res?.value ?? "ua";
    if (lng) {
      await i18n.changeLanguage(lng);
      await changeLanguage(lng);
    }
  } catch (e) {
    console.info("Error loading language:", e);
  }
};

export default i18n;
