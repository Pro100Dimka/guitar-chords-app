// src/screens/index.ts
import { ComponentType } from "react";
import Settings from "./settings";
import Library from "./library";
import Tuner from "./tuner";

interface ScreenConfig {
  component: ComponentType;
  icon: any; // keyof typeofMaterialCommunityIcons
}

export interface Screens {
  [key: string]: ScreenConfig;
}

const screens: Screens = {
  tuner: { component: Tuner, icon: "waveform" },
  library: { component: Library, icon: "music-clef-treble" },
  settings: { component: Settings, icon: "music-rest-quarter" }
};

export default screens;
