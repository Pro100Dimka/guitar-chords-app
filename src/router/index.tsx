/* eslint-disable no-unused-vars */
// src/router/index.tsx
import { createStaticNavigation } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  NativeStackNavigationProp
} from "@react-navigation/native-stack";
import Tabs from "./tabs";
import palette from "../theme/palette";
import Song from "@/screens/song";

export type RootStackParamList = {
  Tabs: undefined;
  Song: { id: string };
  CreateChordSong: undefined;
  Home: undefined;
  Library: undefined;
  Tuner: undefined;
};
export type NavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  keyof RootStackParamList
>;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

const RootStack = createNativeStackNavigator({
  screens: {
    Tabs: {
      screen: Tabs,
      options: {
        animationTypeForReplace: "pop",
        headerShown: false,
        contentStyle: { backgroundColor: palette.colors.transparent }
      }
    },
    Song: {
      screen: Song,
      options: {
        animationTypeForReplace: "pop",
        headerShown: true,
        contentStyle: { backgroundColor: palette.colors.transparent }
      }
    }
  }
});

export default createStaticNavigation(RootStack);
