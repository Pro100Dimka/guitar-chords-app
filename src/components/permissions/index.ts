// permissions.ts
import { Platform } from "react-native";
import checkAndroidPermission from "./permissions.android";
import checkIOSPermission from "./permissions.ios";

const checkPermission =
  Platform.OS === "android" ? checkAndroidPermission : checkIOSPermission;

export default checkPermission;
