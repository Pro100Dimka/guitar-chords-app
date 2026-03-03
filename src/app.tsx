// src/app.tsx
import "@expo/metro-runtime";
import { registerRootComponent } from "expo";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Router from "./router";
import { FC, useEffect } from "react";
import { ImageBackground, StyleSheet, View } from "react-native";
import "./components/utils/logger";
import backgroundImage from "../assets/images/screen-background/background.jpg";
import palette from "./theme/palette";
import { initLanguage } from "./locales";
import { initDB } from "../database";
import { SystemBars } from "react-native-edge-to-edge";
import { SafeAreaProvider } from "react-native-safe-area-context";

const App: FC = () => {
  useEffect(() => {
    initLanguage();
    initDB();
  }, []);
  return (
    <SafeAreaProvider>
      <SystemBars style="light" />
      <GestureHandlerRootView style={styles.flex}>
        <ImageBackground
          source={backgroundImage}
          style={styles.flex}
          resizeMode="cover"
        >
          <View style={styles.overlay} />
          <Router
            fallback={<View style={styles.flex} />}
            linking={{ enabled: "auto", prefixes: ["freetune://"] }}
          />
        </ImageBackground>
      </GestureHandlerRootView>
    </SafeAreaProvider>
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
