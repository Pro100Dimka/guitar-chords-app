import { useCallback } from "react"
import {
  GRAPHIC_MODES,
  GraphicsMode,
  INSTRUMENT_IDS,
  InstrumentType,
  LANGUAGE_IDS,
  LanguageType,
  THEME_IDS,
  ThemeType,
  TUNING_IDS,
  TuningType,
  useConfigStore,
} from "./configStore"
import { useTranslation } from "react-i18next"

/**
 * React hook that provides the proper translation function
 * according to the device's preferences or app settings.
 * @returns a function to use as t('key'), where 'key' keyof Translation.
 */


export const useSettingsOptions = () => {
  const {t} = useTranslation()
  return {
    getInstrumentName: (instrument: InstrumentType): string => {
      switch (instrument) {
        case "guitar":
          return t("guitar")
        case "chromatic":
          return t("chromatic")
      }
    },

    getLanguageName: (language: LanguageType): string => {
      switch (language) {
        case "en":
          return "English"
        case "ru":
          return "Русский"
        case "ua":
          return "Українский"
      }
    },

    getThemeName: (theme: ThemeType): string => {
      switch (theme) {
        case "dark":
          return t("dark")
      }
    },

    getTuningName: (tuning: TuningType): string => {
      switch (tuning) {
        case "ref_440":
          return t("tuning_440")
        case "ref_444":
          return t("tuning_444")
        case "ref_432":
          return t("tuning_432")
      }
    },

    getGraphicModeName: (graphics: GraphicsMode): string => {
      switch (graphics) {
        case "high":
          return t("graphics_high")
        case "low":
          return t("graphics_low")
      }
    },

    getInstruments: function () {
      return INSTRUMENT_IDS.map((id) => ({ id, title: this.getInstrumentName(id) } as any))
    },
    getLanguages: function () {
      return LANGUAGE_IDS.map((id) => ({ id, title: this.getLanguageName(id) } as any))
    },
    getThemes: function () {
      return THEME_IDS.map((id) => ({ id, title: this.getThemeName(id) } as any))
    },
    getTunings: function () {
      return TUNING_IDS.map((id) => ({ id, title: this.getTuningName(id) } as any))
    },
    getGraphics: function () {
      return GRAPHIC_MODES.map((id) => ({ id, title: this.getGraphicModeName(id) } as any))
    },
  }
}
