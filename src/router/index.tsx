import { GuideArticle } from "@/screens/guide";
// src/router/index.tsx
import { createStaticNavigation, RouteProp } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  NativeStackNavigationOptions,
  NativeStackNavigationProp
} from "@react-navigation/native-stack";
import Tabs from "./tabs";
import palette from "../theme/palette";
import Song from "../screens/song";
import CreateChordSong from "@/screens/create-song-chords";
import RecognizeSong from "@/screens/recognize-song";
import type { FormValues } from "@/screens/create-song-chords";
import Header from "@/components/header";

export type RootStackParamList = {
  Tabs: { screen: string; id?: string };
  Song: { id: string; recordings?: boolean } | undefined;
  GuideArticle: { id: string };
  createSong:
    | {
        example?: boolean;
        draft?: Partial<FormValues>;
        notice?:
          | "AddSongLyricsNotice"
          | "AddSongChordsNotice"
          | "AddSongNoLyrics"
          | "AddSongLyricsUnavailable";
      }
    | undefined;
  recognizeSong: { mode: "mic" | "file" | "text" };
};
export type NavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  keyof RootStackParamList
>;
export type ScreenRouteProp = RouteProp<
  RootStackParamList,
  keyof RootStackParamList
>;
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

const guideOptions: NativeStackNavigationOptions = {
  header: ({ navigation }) => (
    <Header
      titleKey="GuideTitle"
      icon="book-open-page-variant-outline"
      showBack
      onBack={() => {
        if (navigation.canGoBack()) navigation.goBack();
        else navigation.replace("Tabs", { screen: "guide" });
      }}
      glass
    />
  ),
  contentStyle: { backgroundColor: palette.colors.transparent }
};

const RootStack = createNativeStackNavigator({
  initialRouteName: "Tabs",
  screenOptions: { animation: "none" },
  screens: {
    GuideArticle: { screen: GuideArticle, options: guideOptions },
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
        headerShown: false,
        contentStyle: { backgroundColor: palette.colors.transparent }
      }
    },
    recognizeSong: {
      screen: RecognizeSong,
      options: {
        header: () => (
          <Header
            titleKey="AddSongTitle"
            icon="music-note-plus"
            showBack
            glass
          />
        ),
        contentStyle: { backgroundColor: palette.colors.transparent }
      }
    },
    createSong: {
      screen: CreateChordSong,
      options: {
        header: () => (
          <Header titleKey="NewSong" icon="music-note-plus" showBack glass />
        ),
        animationTypeForReplace: "pop",
        headerShown: true,
        contentStyle: { backgroundColor: palette.colors.transparent }
      }
    }
  }
});

export default createStaticNavigation(RootStack);
