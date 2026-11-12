import { guitarTunings, standardTuning } from "../screens/tuner/tunings";
import { create } from "zustand";
import { db } from "./database";
import { getAllItems } from "./database/crud";

export interface SongPreferences {
  cover?: string;
  fontSize: number;
  transpose: number;
  capo: number;
  speed: number;
  position: number;
  audioPosition?: number;
  favorite: boolean;
  opened: number;
  shapes: Record<string, number>;
  strum: string;
  strumMeter: 3 | 4;
  strumPreset: string;
  tempo: number;
}
export const defaultSongPreferences: SongPreferences = {
  fontSize: 20,
  transpose: 0,
  capo: 0,
  speed: 18,
  position: 0,
  favorite: false,
  opened: 0,
  shapes: {},
  strum: "",
  strumMeter: 4,
  strumPreset: "",
  tempo: 80
};
interface Preferences {
  instrument: string;
  tuning: string;
  customTuning: number[];
  tunerSound: boolean;
  chromaticOctave: number | null;
  autoDetect: boolean;
  stringIndex: number;
  tab: string;
  songs: Record<string, SongPreferences>;
}
interface PreferencesStore extends Preferences {
  saveError: boolean;
  update: (patch: Partial<Omit<Preferences, "songs">>) => void;
  updateSong: (id: number, patch: Partial<SongPreferences>) => void;
}
let pending: ReturnType<typeof setTimeout> | undefined;
let savingPaused = false;
let revision = 0;
let savedRevision = 0;
export const usePreferences = create<PreferencesStore>((set) => ({
  instrument: "guitar",
  tuning: "standard",
  customTuning: standardTuning,
  tunerSound: true,
  chromaticOctave: null,
  autoDetect: true,
  stringIndex: 0,
  tab: "tuner",
  songs: {},
  saveError: false,
  update: (patch) => {
    set(patch);
    scheduleSave();
  },
  updateSong: (id, patch) => {
    set((state) => ({
      songs: {
        ...state.songs,
        [id]: { ...defaultSongPreferences, ...state.songs[id], ...patch }
      }
    }));
    scheduleSave();
  }
}));
function scheduleSave() {
  revision++;
  if (pending !== undefined) clearTimeout(pending);
  pending = setTimeout(flushPreferences, 250);
}
export function suspendPreferenceSaving() {
  flushPreferences();
  savingPaused = true;
  return () => {
    savingPaused = false;
    flushPreferences();
  };
}
export function flushPreferences() {
  if (savingPaused) return;
  if (pending !== undefined) clearTimeout(pending);
  pending = undefined;
  const {
    instrument,
    tuning,
    customTuning,
    tunerSound,
    chromaticOctave,
    autoDetect,
    stringIndex,
    tab,
    songs
  } = usePreferences.getState();
  if (revision === savedRevision && !usePreferences.getState().saveError)
    return;
  const savingRevision = revision;
  db.transaction(
    (tx) => {
      tx.executeSql(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        [
          "experience",
          JSON.stringify({
            instrument,
            tuning,
            customTuning,
            tunerSound,
            chromaticOctave,
            autoDetect,
            stringIndex,
            tab,
            songs
          })
        ]
      );
    },
    () => usePreferences.setState({ saveError: true }),
    () => {
      savedRevision = savingRevision;
      if (savingRevision === revision)
        usePreferences.setState({ saveError: false });
    }
  );
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
export function normalizeSongPreferences(value: unknown): SongPreferences {
  const song = record(value) ? value : {};
  const shapes: Record<string, number> = {};
  if (record(song.shapes))
    Object.entries(song.shapes).forEach(([chord, index]) => {
      if (
        typeof index === "number" &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < 256
      )
        shapes[chord] = index;
    });
  return {
    cover:
      typeof song.cover === "string" &&
      song.cover.startsWith("data:image/jpeg;base64,") &&
      song.cover.length <= 300000
        ? song.cover
        : "",
    fontSize: number(song.fontSize, 20, 16, 32),
    transpose: Math.round(number(song.transpose, 0, -11, 11)),
    capo: Math.round(number(song.capo, 0, 0, 12)),
    speed: number(song.speed, 18, 4, 60),
    position: number(song.position, 0, 0, 1000000),
    audioPosition: number(song.audioPosition, 0, 0, 7200),
    favorite: song.favorite === true,
    opened: number(song.opened, 0, 0, Number.MAX_SAFE_INTEGER),
    shapes,
    strum:
      typeof song.strum === "string"
        ? song.strum.replace(/[^DUX-]/g, "").slice(0, 16)
        : "",
    strumMeter: song.strumMeter === 3 ? 3 : 4,
    strumPreset:
      typeof song.strumPreset === "string" ? song.strumPreset.slice(0, 32) : "",
    tempo: Math.round(number(song.tempo, 80, 40, 200))
  };
}
export async function loadPreferences() {
  const [row] = await getAllItems<{ value: string }>({
    tableName: "settings",
    filters: "key = ?",
    parameters: ["experience"]
  });
  if (!row) return;
  let data: unknown;
  try {
    data = JSON.parse(row.value);
  } catch {
    usePreferences.setState({ saveError: true });
    return;
  }
  if (!record(data)) return;
  const songs: Record<string, SongPreferences> = {};
  if (record(data.songs))
    Object.entries(data.songs).forEach(([id, song]) => {
      if (!record(song) || !/^\d+$/.test(id)) return;
      songs[id] = normalizeSongPreferences(song);
    });
  usePreferences.setState({
    songs,
    instrument: data.instrument === "chromatic" ? "chromatic" : "guitar",
    tuning:
      typeof data.tuning === "string" &&
      [...Object.keys(guitarTunings), "custom"].includes(data.tuning)
        ? data.tuning
        : "standard",
    customTuning:
      Array.isArray(data.customTuning) && data.customTuning.length === 6
        ? data.customTuning.map((note, i) =>
            Math.round(number(note, standardTuning[i], 28, 88))
          )
        : standardTuning,
    tunerSound: data.tunerSound !== false,
    chromaticOctave:
      typeof data.chromaticOctave === "number" &&
      [1, 2, 3, 4, 5, 6].includes(data.chromaticOctave)
        ? data.chromaticOctave
        : null,
    autoDetect: data.autoDetect !== false,
    stringIndex: Math.round(number(data.stringIndex, 0, 0, 5)),
    tab:
      typeof data.tab === "string" &&
      ["tuner", "library", "settings"].includes(data.tab)
        ? data.tab
        : "tuner"
  });
}
