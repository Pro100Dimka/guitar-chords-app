// src/tuner/config/guitar-classic.ts
import { IInstrument } from "@/@interfaces";
import GuitarIcon from "./icons/guitar";

const guitsClassic: IInstrument = {
  Icon: GuitarIcon,
  stringNotes: [
    {
      name: "E",
      thickness: 4,
      baseColor: [0.78, 0.58, 0.2],
      octave: 2
    },
    {
      name: "A",
      thickness: 3.5,
      baseColor: [0.82, 0.62, 0.22],
      octave: 2
    },
    {
      name: "D",
      thickness: 3,
      baseColor: [0.86, 0.66, 0.24],
      octave: 3
    },
    {
      name: "G",
      thickness: 2.5,
      baseColor: [0.9, 0.7, 0.26],
      octave: 3
    },
    {
      name: "B",
      thickness: 2,
      baseColor: [0.93, 0.75, 0.28],
      octave: 3
    },
    {
      name: "E",
      thickness: 1.5,
      baseColor: [0.95, 0.9, 0.7],
      octave: 4
    }
  ]
};
export default guitsClassic;
