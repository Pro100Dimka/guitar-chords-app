// src/app.tsx
import "@expo/metro-runtime";
import { registerRootComponent } from "expo";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Router from "./router";
import { FC, useEffect } from "react";
import { ImageBackground, StatusBar, StyleSheet, View } from "react-native";
import "./components/utils/logger";
import backgroundImage from "../assets/images/guitar-background.jpg";
import palette from "./theme/palette";
import { initLanguage } from "./locales";
import { initDB } from "../database";

const App: FC = () => {
  useEffect(() => {
    initLanguage();
    initDB();
  }, []);

  return (
    <GestureHandlerRootView style={styles.flex}>
      <ImageBackground
        source={backgroundImage}
        style={styles.flex}
        resizeMode="cover"
      >
        <StatusBar barStyle="default" backgroundColor="transparent" hidden />
        <View style={styles.overlay} />
        <Router
          fallback={<View style={styles.flex} />}
          linking={{
            enabled: "auto",
            prefixes: ["guitar-chords-songs://"]
          }}
        />
      </ImageBackground>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.colors.blackOpacityTiny
  }
});

registerRootComponent(App);
