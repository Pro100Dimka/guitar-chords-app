import AsyncStorage from "@react-native-async-storage/async-storage";
import { StateStorage } from "zustand/middleware"


export const localStorage =  AsyncStorage

export const zustandStorage: StateStorage = {
  setItem: (name, value) => {
    return localStorage.setItem(name, value)
  },
  getItem: (name) => {
    const value = localStorage.getItem(name)
    return value ?? null
  },
  removeItem: (name) => {
    return localStorage.removeItem(name)
  },
}
