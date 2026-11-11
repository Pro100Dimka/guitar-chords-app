import { createContext } from "react";

export const TunerReadyContext = createContext<(() => void) | undefined>(
  undefined
);
