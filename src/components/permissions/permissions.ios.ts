// permissions.ios.ts
import { request, PERMISSIONS } from "react-native-permissions";

const checkIOSPermission = async () => {
  const result = await request(PERMISSIONS.IOS.MICROPHONE);
  return result === "granted";
};
export default checkIOSPermission;
