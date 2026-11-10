// permissions.android.ts
import { PermissionsAndroid } from "react-native";

const checkAndroidPermission = async (requestPermission = true) => {
  if (!requestPermission) {
    return PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
    );
  }
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
};
export default checkAndroidPermission;
