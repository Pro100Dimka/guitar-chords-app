// src/screens/index.ts
import { ComponentType } from "react";
import Settings from "./settings";
import Library from "./library";
import Tuner from "./tuner";
import Guide from "./guide";

interface ScreenConfig {
  component: ComponentType;
  icon: any; // keyof typeofMaterialCommunityIcons
  title?: string;
}

export interface Screens {
  [key: string]: ScreenConfig;
}

const screens: Screens = {
  tuner: { component: Tuner, icon: "waveform" },
  library: { component: Library, icon: "music-clef-treble" },
  settings: { component: Settings, icon: "music-rest-quarter" },
  guide: {
    component: Guide,
    icon: "book-open-page-variant-outline",
    title: "GuideTitle"
  }
};

export default screens;
