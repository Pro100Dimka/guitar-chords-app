import { cooperativeWork } from "./cooperative-work";
import { guitarTunings, standardTuning } from "../screens/tuner/tunings";
import {
  MAX_GUITAR_ZOOM,
  MIN_GUITAR_ZOOM
} from "../screens/tuner/guitar-layout";
import { create } from "zustand";
import type { SQLTransaction } from "react-native-sqlite-2";
import { db } from "./database";
import { getAllItems } from "./database/crud";
import { normalizeTablature, Tablature } from "./tablature";
import {
  normalizeTabPractice,
  TabPracticeSettings
} from "./tablature-practice";

export interface SongPreferences {
  tablature?: Tablature;
  tabPractice?: TabPracticeSettings;
  backupId?: string;
  cover?: string;
  sourceTuning?: string;
  contentSource?: { name: string; url: string; credit?: string };
  fontSize: number;
  transpose: number;
  capo: number;
  speed: number;
  position: number;
  favorite: boolean;
  opened: number;
  shapes: Record<string, number>;
  strum: string;
  strumMeter: 2 | 3 | 4;
  strumDivision: number;
  strumPreset: string;
  tempo: number;
  rhythmSections: Record<string, SongRhythm>;
}
export type SongRhythm = Pick<
  SongPreferences,
  "strum" | "strumMeter" | "strumDivision" | "strumPreset"
>;
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
  strumDivision: 2,
  strumPreset: "",
  rhythmSections: {},
  tempo: 80
};
interface Preferences {
  instrument: string;
  tuning: string;
  customTuning: number[];
  tunerSound: boolean;
  tunerReference: number;
  tunerSpectrum: boolean;
  playGuitarZoom: number;
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
  removeSong: (id: number) => void;
}
let pending: ReturnType<typeof setTimeout> | undefined;
let savingPaused = 0;
let saving: Promise<void> | undefined;
let revision = 0;
let savedRevision = 0;
let savedSongs: Record<string, SongPreferences> = {};
export const usePreferences = create<PreferencesStore>((set, get) => ({
  instrument: "guitar",
  tuning: "standard",
  customTuning: standardTuning,
  tunerSound: true,
  tunerReference: 440,
  tunerSpectrum: false,
  playGuitarZoom: 1,
  chromaticOctave: null,
  autoDetect: true,
  stringIndex: 0,
  tab: "tuner",
  songs: {},
  saveError: false,
  update: (patch) => {
    const state = get();
    if (
      Object.entries(patch).every(([key, value]) =>
        Object.is(state[key as keyof Preferences], value)
      )
    )
      return;
    set(patch);
    scheduleSave();
  },
  removeSong: (id) => {
    if (get().songs[id] === undefined) return;
    set((state) => {
      const songs = { ...state.songs };
      delete songs[id];
      return { songs };
    });
    scheduleSave();
  },
  updateSong: (id, patch) => {
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const previous = get().songs[id];
    if (
      previous &&
      Object.entries(patch).every(([key, value]) =>
        Object.is(previous[key as keyof SongPreferences], value)
      )
    )
      return;
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
  savingPaused++;
  return (persistedSongs?: Record<string, SongPreferences>) => {
    if (persistedSongs) savedSongs = { ...savedSongs, ...persistedSongs };
    savingPaused--;
    flushPreferences();
  };
}
export function flushPreferences() {
  if (savingPaused) return Promise.resolve();
  if (saving) return saving;
  if (pending !== undefined) clearTimeout(pending);
  pending = undefined;
  const state = usePreferences.getState();
  if (revision === savedRevision && !usePreferences.getState().saveError)
    return Promise.resolve();
  const savingRevision = revision;
  let finish!: () => void;
  const result = new Promise<void>((resolve) => {
    finish = resolve;
  });
  saving = result;
  const failed = () => {
    if (saving !== result) return;
    saving = undefined;
    usePreferences.setState({ saveError: true });
    finish();
  };
  try {
    db.transaction(
      (tx) => writePreferences(tx, state),
      failed,
      () => {
        if (saving !== result) return;
        saving = undefined;
        savedRevision = savingRevision;
        savedSongs = state.songs;
        if (savingRevision === revision) {
          usePreferences.setState({ saveError: false });
          finish();
        } else void flushPreferences().then(finish);
      }
    );
  } catch {
    failed();
  }
  return result;
}
export function writePreferences(tx: SQLTransaction, state: Preferences) {
  const { songs } = state;
  const settings = Object.fromEntries(
    Object.entries(state).filter(
      ([key, value]) =>
        !["songs", "saveError"].includes(key) && typeof value !== "function"
    )
  );
  tx.executeSql("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [
    "experience",
    JSON.stringify(settings)
  ]);
  for (const [id, song] of Object.entries(songs)) {
    if (savedSongs[id] === song) continue;
    tx.executeSql("DELETE FROM settings WHERE key LIKE ?", [`song:${id}:%`]);
    const text = JSON.stringify(normalizeSongPreferences(song));
    let part = 0;
    for (let start = 0; start < text.length; ) {
      let end = Math.min(text.length, start + 65536);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      tx.executeSql(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        [`song:${id}:${part++}`, text.slice(start, end)]
      );
      start = end;
    }
  }
  for (const id of Object.keys(savedSongs)) {
    if (!(id in songs))
      tx.executeSql("DELETE FROM settings WHERE key LIKE ?", [`song:${id}:%`]);
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
export function normalizeSongPreferences(value: unknown): SongPreferences {
  const song = record(value) ? value : {};
  const source = record(song.contentSource) ? song.contentSource : {};
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
    tablature: normalizeTablature(song.tablature),
    tabPractice:
      song.tabPractice === undefined
        ? undefined
        : normalizeTabPractice(song.tabPractice),
    backupId:
      typeof song.backupId === "string" &&
      /^[a-zA-Z0-9:-]{1,100}$/.test(song.backupId)
        ? song.backupId
        : undefined,
    sourceTuning:
      typeof song.sourceTuning === "string"
        ? song.sourceTuning.slice(0, 100)
        : undefined,
    contentSource:
      typeof source.name === "string" &&
      [
        "LRCLIB",
        "Пісенник",
        "lyrics.ovh",
        "Cifra Club",
        "E-Chords",
        "Cifras",
        "GuitareTab",
        "Akkords.pro",
        "Musicaccord.ru",
        "Chords & Tabs",
        "Sonidos",
        "WeingGuitar",
        "Akkords.fun",
        "LalaTracker",
        "Shazam"
      ].includes(source.name) &&
      typeof source.url === "string" &&
      source.url.length < 1000 &&
      /^https:\/\/(?:pisennyk\.com\.ua|lrclib\.net|api\.lyrics\.ovh|www\.cifraclub\.com|www\.e-chords\.com|www\.cifras\.com\.br|www\.guitaretab\.com|akkords\.pro|musicaccord\.ru|www\.chords-and-tabs\.net|www\.sonidos\.com\.br|guitar\.weingchicken\.com|akkords\.fun|lalatracker\.com|www\.shazam\.com)\//.test(
        source.url
      )
        ? {
            name: source.name,
            url: source.url,
            ...(typeof source.credit === "string" &&
            source.credit.length <= 2000
              ? { credit: source.credit }
              : {})
          }
        : undefined,
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
    favorite: song.favorite === true,
    opened: number(song.opened, 0, 0, Number.MAX_SAFE_INTEGER),
    shapes,
    ...normalizeRhythm(song),
    rhythmSections: Object.fromEntries(
      Object.entries(record(song.rhythmSections) ? song.rhythmSections : {})
        .filter(([key]) => key.length > 0 && key.length <= 100)
        .slice(0, 128)
        .map(([key, rhythm]) => [key, normalizeRhythm(rhythm)])
    ),
    tempo: Math.round(number(song.tempo, 80, 40, 200))
  };
}
export function preserveSongPreferenceChanges(
  persisted: SongPreferences | undefined,
  snapshot: SongPreferences | undefined,
  current: SongPreferences | undefined
) {
  return normalizeSongPreferences({
    ...persisted,
    ...Object.fromEntries(
      Object.entries(current ?? {}).filter(
        ([key, value]) => value !== snapshot?.[key as keyof SongPreferences]
      )
    )
  });
}

export function normalizeRhythm(value: unknown): SongRhythm {
  const rhythm = record(value) ? value : {};
  return {
    strum:
      typeof rhythm.strum === "string"
        ? rhythm.strum.replace(/[^DUXBA1-6-]/g, "").slice(0, 16)
        : "",
    strumMeter:
      ([2, 3, 4] as const).find((meter) => meter === rhythm.strumMeter) ?? 4,
    strumDivision:
      [2, 3, 4].find((division) => division === Number(rhythm.strumDivision)) ??
      2,
    strumPreset:
      typeof rhythm.strumPreset === "string"
        ? rhythm.strumPreset.slice(0, 32)
        : ""
  };
}
function readSavedSong(value: unknown): SongPreferences {
  try {
    if (!record(value)) throw new Error("PreferenceReadFailed");
    const song = normalizeSongPreferences(value);
    // Do not silently discard a damaged score during an otherwise successful
    // startup or legacy migration. The stored document must remain recoverable.
    if (value.tablature !== undefined && !song.tablature)
      throw new Error("PreferenceReadFailed");
    return song;
  } catch {
    usePreferences.setState({ saveError: true });
    throw new Error("PreferenceReadFailed");
  }
}
export async function loadPreferences() {
  const checkpoint = cooperativeWork();
  const [size] = await getAllItems<{ length: number }>({
    tableName: "settings",
    fields: "length(value) AS length",
    filters: "key = ?",
    parameters: ["experience"]
  });
  let text = "";
  for (let offset = 1; offset <= (size?.length ?? 0); offset += 65536) {
    const [chunk] = await getAllItems<{ value: string }>({
      tableName: "settings",
      fields: `substr(value, ${offset}, 65536) AS value`,
      filters: "key = ?",
      parameters: ["experience"]
    });
    if (!chunk) throw new Error("PreferenceReadFailed");
    text += chunk.value;
  }
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (!record(parsed)) throw new Error("PreferenceReadFailed");
    data = parsed;
  } catch {
    usePreferences.setState({ saveError: true });
  }
  const songs: Record<string, SongPreferences> = {};
  if (record(data.songs))
    for (const [id, song] of Object.entries(data.songs)) {
      if (record(song) && /^\d+$/.test(id)) songs[id] = readSavedSong(song);
      const pause = checkpoint();
      if (pause) await pause;
    }
  const rows = await getAllItems<{ key: string; value: string }>({
    tableName: "settings",
    filters: "key LIKE ?",
    parameters: ["song:%"]
  });
  const pieces = new Map<string, Map<number, string>>();
  for (const row of rows) {
    const pause = checkpoint();
    if (pause) await pause;
    const match = /^song:(\d+):(\d+)$/.exec(row.key);
    if (!match) continue;
    const parts = pieces.get(match[1]) ?? new Map<number, string>();
    parts.set(Number(match[2]), row.value);
    pieces.set(match[1], parts);
  }
  for (const [id, parts] of pieces) {
    const text = Array.from({ length: parts.size }, (_, index) => {
      const part = parts.get(index);
      if (part === undefined) throw new Error("PreferenceReadFailed");
      return part;
    }).join("");
    try {
      songs[id] = readSavedSong(JSON.parse(text));
    } catch {
      usePreferences.setState({ saveError: true });
      throw new Error("PreferenceReadFailed");
    }
    const pause = checkpoint();
    if (pause) await pause;
  }
  const state: Preferences = {
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
    tunerReference: Math.round(number(data.tunerReference, 440, 400, 480)),
    tunerSpectrum: data.tunerSpectrum === true,
    playGuitarZoom: number(
      data.playGuitarZoom,
      1,
      MIN_GUITAR_ZOOM,
      MAX_GUITAR_ZOOM
    ),
    chromaticOctave:
      typeof data.chromaticOctave === "number" &&
      [1, 2, 3, 4, 5, 6].includes(data.chromaticOctave)
        ? data.chromaticOctave
        : null,
    autoDetect: data.autoDetect !== false,
    stringIndex: Math.round(number(data.stringIndex, 0, 0, 5)),
    tab:
      typeof data.tab === "string" &&
      ["tuner", "play", "library", "settings", "guide"].includes(data.tab)
        ? data.tab
        : "tuner"
  };
  if (record(data.songs)) {
    await new Promise<void>((resolve, reject) =>
      db.transaction((tx) => writePreferences(tx, state), reject, resolve)
    );
  }
  savedSongs = songs;
  usePreferences.setState(state);
}
