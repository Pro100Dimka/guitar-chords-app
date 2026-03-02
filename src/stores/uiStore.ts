import { InstrumentString } from "@/screens/tuner/instruments";
import { create } from "zustand";

const PITCH_HISTORY = 3;
const RMS_HISTORY = 3;
const STRING_HISTORY = 3;
const ID_HISTORY = 3;
interface IUiState {
  pitchHistory: number[];
  addPitch: (_: number) => void;

  rmsHistory: number[];
  addRMS: (_: number) => void;

  idHistory: number[];
  addId: (_: number) => void;

  stringHistory: (InstrumentString | undefined)[];
  addString: (_?: InstrumentString) => void;

  currentString?: InstrumentString;
  setCurrentString: (_?: InstrumentString) => void;
}
const pushFixed = <T>(arr: T[], value: T) => {
  if (arr[arr.length - 1] === value) return arr;
  const next = arr.slice(1);
  next.push(value);
  return next;
};

export const useUiStore = create<IUiState>((set, get) => ({
  pitchHistory: Array(PITCH_HISTORY).fill(-1),
  rmsHistory: Array(RMS_HISTORY).fill(0),
  idHistory: Array(ID_HISTORY).fill(0),
  stringHistory: Array<InstrumentString | undefined>(STRING_HISTORY).fill(
    undefined
  ),
  addPitch: (pitch) => {
    const prev = get().pitchHistory;
    const next = pushFixed(prev, pitch);
    if (next !== prev) set({ pitchHistory: next });
  },
  addRMS: (rms) => {
    const prev = get().rmsHistory;
    const next = pushFixed(prev, rms);
    if (next !== prev) set({ rmsHistory: next });
  },
  addId: (id) => {
    const prev = get().idHistory;
    const next = pushFixed(prev, id);
    if (next !== prev) set({ idHistory: next });
  },
  addString: (string) => {
    const prev = get().stringHistory;
    const next = pushFixed(prev, string);
    if (next !== prev) set({ stringHistory: next });
  },
  currentString: undefined,
  setCurrentString: (currentString) => {
    if (get().currentString !== currentString) {
      set({ currentString });
    }
  }
}));
