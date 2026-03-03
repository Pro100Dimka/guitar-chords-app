import AsyncStorage from "@react-native-async-storage/async-storage";

type StateStorage = {
  getItem: (_: string) => string | null | Promise<string | null>;
  setItem: (_: string, __: string) => void | Promise<void>;
  removeItem: (_: string) => void | Promise<void>;
};

export const localStorage = AsyncStorage;

export const zustandStorage: StateStorage = {
  setItem: localStorage.setItem,
  getItem: localStorage.getItem,
  removeItem: localStorage.removeItem
};
