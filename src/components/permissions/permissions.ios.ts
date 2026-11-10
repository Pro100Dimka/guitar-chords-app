// permissions.ios.ts
import { check, request, PERMISSIONS } from "react-native-permissions";

const checkIOSPermission = async (requestPermission = true) => {
  const result = await (requestPermission ? request : check)(
    PERMISSIONS.IOS.MICROPHONE
  );
  return result === "granted";
};
export default checkIOSPermission;
