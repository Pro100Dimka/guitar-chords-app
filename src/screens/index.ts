// src/screens/index.ts
import { ComponentType } from "react";
import Home from "./home";
import Library from "./library";
import CreateChordSong from "./create-song-chords";
import Tuner from "./tuner";

interface ScreenConfig {
  component: ComponentType;
  icon: any; // keyof typeofMaterialCommunityIcons
}

export interface Screens {
  [key: string]: ScreenConfig;
}

const screens: Screens = {
  home: { component: Home, icon: "guitar-acoustic" },
  library: { component: Library, icon: "music-clef-treble" },
  createSong: { component: CreateChordSong, icon: "music-note-plus" },
  tuner: { component: Tuner, icon: "waveform" }
};

export default screens;
