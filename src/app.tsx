import React, { FC, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  ImageBackground,
  Platform,
  Pressable,
  StyleSheet,
  View
} from "react-native";
import Text from "./components/styled-text";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SystemBars } from "react-native-edge-to-edge";
import Router from "./router";
import backgroundImage from "../assets/images/gold-background.png";
import palette from "./theme/palette";
import { initLanguage, t } from "./locales";
import { initDatabase } from "./components/database";
import SplashScreen from "react-native-splash-screen";
import Support from "./components/support";
import {
  flushPreferences,
  loadPreferences,
  usePreferences
} from "./components/preferences";

const App: FC = () => {
  const saveError = usePreferences((state) => state.saveError);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        await initDatabase();
        await initLanguage();
        await loadPreferences();
        if (active) setReady(true);
      } catch (error) {
        console.error("Application initialization failed:", error);
        if (active) setFailed(true);
      }
    };
    void init();
    return () => {
      active = false;
    };
  }, [attempt]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") flushPreferences();
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if ((ready || failed) && Platform.OS === "android") SplashScreen.hide();
  }, [ready, failed]);

  return (
    <SafeAreaProvider>
      <SystemBars style="light" />
      <GestureHandlerRootView style={styles.flex}>
        <ImageBackground
          source={backgroundImage}
          style={styles.flex}
          resizeMode="stretch"
        >
          <View style={styles.overlay} />
          {failed && (
            <View style={styles.status}>
              <Text style={styles.statusText}>{t("ErrorStartingApp")}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setFailed(false);
                  setAttempt((value) => value + 1);
                }}
              >
                <Text style={styles.statusText}>{t("Retry")}</Text>
              </Pressable>
            </View>
          )}
          {!ready && !failed && (
            <ActivityIndicator
              style={styles.status}
              color={palette.colors.white}
            />
          )}
          {ready && <Support />}
          {ready && (
            <Router
              fallback={<View style={styles.flex} />}
              linking={{ enabled: "auto", prefixes: ["freetune://"] }}
            />
          )}
          {ready && saveError && (
            <Pressable onPress={flushPreferences} style={styles.saveError}>
              <Text style={styles.statusText}>{t("PreferencesSaveError")}</Text>
            </Pressable>
          )}
        </ImageBackground>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
};

const styles = StyleSheet.create({
  saveError: { backgroundColor: palette.chromatic.panel },
  status: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  statusText: { color: palette.colors.white, textAlign: "center", padding: 16 },
  flex: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.colors.transparent
  }
});

export default App;
