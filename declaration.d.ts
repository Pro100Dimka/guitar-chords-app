declare module "*.png";
declare module "*.jpg";
declare module "*.jpeg";
declare module "*.gif";
declare module "*.svg";
declare module "react-native-vector-icons/Ionicons";
declare module "react-native-vector-icons/FontAwesome";
declare module "react-native-intent-launcher";
declare module "react-native-vector-icons/MaterialIcons" {
  import { ComponentType } from "react";
  import { TextProps } from "react-native";
  const content: ComponentType<
    TextProps & { name: string; size?: number; color?: string }
  >;
  export default content;
}
