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
  library: { component: Library, icon: "music-clef-treble" },
  tuner: { component: Tuner, icon: "waveform" },
  settings: { component: Settings, icon: "music-rest-quarter" }
};

export default screens;
