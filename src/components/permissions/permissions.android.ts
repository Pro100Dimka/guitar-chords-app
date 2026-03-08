// permissions.android.ts
import { PermissionsAndroid } from "react-native";

const checkAndroidPermission = async () => {
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
};
export default checkAndroidPermission;
