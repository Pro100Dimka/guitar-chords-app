// src/tuner/config/index.ts
import guitar from "./guitar-classic";
import chromatic from "./chromatic";
import { ITunerConfig } from "@/@interfaces";

const instruments = { chromatic, guitar };

const config: ITunerConfig = {
  instruments,
  autoDetect: true,
  // selectedInstrument: "chromatic",
  selectedInstrument: "guitar"
};
export default config;
