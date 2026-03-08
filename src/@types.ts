import { IModel, IString } from "./@interfaces";

export type TModelFields =
  | "INTEGER PRIMARY KEY AUTOINCREMENT"
  | "TEXT PRIMARY KEY"
  | "TEXT"
  | "INTEGER"
  | "REAL"
  | "BOOLEAN"
  | "TEXT NOT NULL"
  | "INTEGER NOT NULL";
export type TFields = Record<string, TModelFields>;
export type IModels = Record<string, IModel>;

export type MicrophoneAccess = "pending" | "granted" | "denied";
export type PitchFilterParams = {
  minFreq: number;
  maxFreq: number;
  threshold: number;
};
export type ParagraphTuple = [string, number, number, string];
export type ParagraphProps = [ParagraphTuple, [number, number, number]];
export type Point = { x: number; y: number } | any;
export type InstrumentString = { note: IString; freq: number };
