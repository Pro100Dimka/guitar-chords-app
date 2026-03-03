import { Platform } from "react-native";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "./localStorage";

export const INSTRUMENT_IDS = ["guitar", "chromatic"] as const;
export const THEME_IDS = ["dark"] as const;
export const TUNING_IDS = ["ref_440", "ref_432", "ref_444"] as const;
export const GRAPHIC_MODES = ["low", "high"] as const;

export type InstrumentType = (typeof INSTRUMENT_IDS)[number];
export type TuningType = (typeof TUNING_IDS)[number];
export type GraphicsMode = (typeof GRAPHIC_MODES)[number];

export interface ConfigState {
  instrument: InstrumentType;
  tuning: TuningType;
  graphics: GraphicsMode;
  manual: boolean;
  setInstrument: (_: InstrumentType) => void;
  setTuning: (_: TuningType) => void;
  setGraphics: (_: GraphicsMode) => void;
  setManual: (_: boolean) => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      graphics: Platform.OS === "ios" ? "high" : "low",
      instrument: "guitar",
      tuning: "ref_440",
      manual: false,
      setGraphics: (graphics: GraphicsMode) => set({ graphics }),
      setInstrument: (instrument: InstrumentType) => set({ instrument }),
      setTuning: (tuning: TuningType) => set({ tuning }),
      setManual: (manual) => set({ manual })
    }),
    {
      name: "config-store",
      storage: createJSONStorage(() => zustandStorage),
      merge: (persistedState, currentState) => {
        const loadedState = { ...currentState };
        const savedState = persistedState as ConfigState;
        if (GRAPHIC_MODES.includes(savedState.graphics as any)) {
          loadedState.graphics = savedState.graphics;
        }
        return loadedState;
      }
    }
  )
);

/**
 * Get best available locale according to user's settings on device.
 * @returns a LanguageType that is available on the device
 */
export function getTuningFreq(tuning: TuningType): number {
  switch (tuning) {
    case "ref_440":
      return 440;
    case "ref_432":
      return 432;
    case "ref_444":
      return 444;
  }
}
