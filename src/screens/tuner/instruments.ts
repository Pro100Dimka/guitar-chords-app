import { InstrumentType, TuningType } from "@/@types";
import { getFreqFromNote, getNoteFromFreq, Note } from "../../stores/notes";
import { IString } from "@/@interfaces";

export type InstrumentString = { note: Note; freq: number };

export abstract class Instrument {
  tuning: TuningType;
  abstract readonly name: InstrumentType;
  abstract readonly hasStrings: boolean;
  constructor(tuning: TuningType) {
    this.tuning = tuning;
  }
  abstract getStrings(): Note[];
  abstract getNearestString(_: number): InstrumentString | undefined;
  getNearestIdx(frequency: number, freqs: number[]): number | undefined {
    // TODO: Evaluate if measure in semitones instead of linear frequency ?
    let minDistance = Infinity;
    let minIdx = 0;
    for (let i = 0; i < freqs.length; i++) {
      const d = Math.abs(frequency - freqs[i]);
      if (d < minDistance) {
        minDistance = d;
        minIdx = i;
      }
    }
    return minIdx;
  }
}

export class Guitar extends Instrument {
  stringNotes: Note[] = [
    { name: "E", thickness: 4, baseColor: [0.78, 0.58, 0.2], octave: 2 }, // тёмное золото
    { name: "A", thickness: 3.5, baseColor: [0.82, 0.62, 0.22], octave: 2 }, // золотистая бронза
    { name: "D", thickness: 3, baseColor: [0.86, 0.66, 0.24], octave: 3 }, // яркое золото
    { name: "G", thickness: 2.5, baseColor: [0.9, 0.7, 0.26], octave: 3 }, // светлое золото
    { name: "B", thickness: 2, baseColor: [0.93, 0.75, 0.28], octave: 3 }, // почти жёлтое золото
    { name: "E", thickness: 1.5, baseColor: [0.95, 0.9, 0.7], octave: 4 } // светлое золото с серебристым отблеском
  ];
  stringFreqs: number[]; // depends on tuning type

  constructor(tuning: TuningType) {
    super(tuning);
    this.stringFreqs = this.stringNotes.map((note) =>
      getFreqFromNote(note, tuning)
    );
  }

  get name(): InstrumentType {
    return "guitar";
  }

  get hasStrings() {
    return true;
  }

  getStrings(): Note[] {
    return this.stringNotes;
  }

  getNearestString(freq: number): InstrumentString | undefined {
    const idx = this.getNearestIdx(freq, this.stringFreqs);
    if (idx === undefined) return undefined;
    const note = this.stringNotes[idx];
    return { note, freq: this.stringFreqs[idx] };
  }
}

export class Chromatic extends Instrument {
  get name(): InstrumentType {
    return "chromatic";
  }

  get hasStrings() {
    return false;
  }

  getStrings(): Note[] {
    return [];
  }

  getNearestString(freq: number): InstrumentString | undefined {
    // Find nearest note
    const note = getNoteFromFreq(freq, this.tuning);
    if (!note) return undefined;

    // Find frequency of the nearest note
    const noteFreq = getFreqFromNote(note, this.tuning);
    return { note, freq: noteFreq };
  }
}
export const instruments = {
  guitar: Guitar,
  chromatic: Chromatic
};
