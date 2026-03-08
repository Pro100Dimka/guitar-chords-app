// src/tuner/config/index.ts
import guitar from "./guitar-classic";
import chromatic from "./chromatic";
import { ITunerConfig } from "@/@interfaces";

const instruments = { chromatic, guitar };
const tunings = [`440hz`, `432hz`, `444hz`];

const config: ITunerConfig = {
  instruments,
  tunings,
  autoDetect: true,
  selectedTuning: "432hz",
  selectedInstrument: "guitar"
};
export default config;
