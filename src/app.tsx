import React, { FC, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AccessibilityInfo,
  Animated,
  AppState,
  ImageBackground,
  Image,
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
import { initializeSongAnalysis } from "./components/song-analysis/startup";
import SplashScreen from "react-native-splash-screen";
import Support from "./components/support";
import {
  ParamListBase,
  useNavigationContainerRef
} from "@react-navigation/native";
import { TunerReadyContext } from "./components/startup";
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
  const navigation = useNavigationContainerRef<ParamListBase>();
  const [waitForTuner, setWaitForTuner] = useState(false);
  const [tunerReady, setTunerReady] = useState(false);
  const markTunerReady = useCallback(() => setTunerReady(true), []);
  const [navigationReady, setNavigationReady] = useState(false);
  const [launching, setLaunching] = useState(true);
  const [loadedArt, setLoadedArt] = useState<Record<string, boolean>>({});
  const artReady = ["background", "dawn", "mark", "wordmark"].every(
    (key) => loadedArt[key]
  );
  const launchOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        await initDatabase();
        await initializeSongAnalysis();
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
    if (
      !launching ||
      !artReady ||
      !(failed || (ready && navigationReady && (!waitForTuner || tunerReady)))
    )
      return;
    let active = true;
    let animation: Animated.CompositeAnimation | undefined;
    const frame = requestAnimationFrame(() => {
      if (Platform.OS === "android") SplashScreen.hide();
      void AccessibilityInfo.isReduceMotionEnabled()
        .catch(() => false)
        .then((reduce) => {
          if (!active) return;
          animation = Animated.timing(launchOpacity, {
            toValue: 0,
            duration: reduce ? 0 : 650,
            useNativeDriver: true
          });
          animation.start(({ finished }) => {
            if (finished && active) setLaunching(false);
          });
        });
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      animation?.stop();
    };
  }, [
    ready,
    failed,
    waitForTuner,
    tunerReady,
    navigationReady,
    artReady,
    launching,
    launchOpacity
  ]);

  return (
    <SafeAreaProvider>
      <SystemBars style="light" />
      <GestureHandlerRootView style={styles.flex}>
        <TunerReadyContext.Provider value={markTunerReady}>
          <ImageBackground
            source={backgroundImage}
            style={styles.flex}
            resizeMode="stretch"
            onLoadEnd={() =>
              setLoadedArt((value) => ({ ...value, background: true }))
            }
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
                ref={navigation}
                onReady={() => {
                  setWaitForTuner(
                    navigation.current?.getCurrentRoute()?.name === "tuner"
                  );
                  setNavigationReady(true);
                }}
                fallback={<View style={styles.flex} />}
                linking={{ enabled: "auto", prefixes: ["freetune://"] }}
              />
            )}
            {ready && saveError && (
              <Pressable onPress={flushPreferences} style={styles.saveError}>
                <Text style={styles.statusText}>
                  {t("PreferencesSaveError")}
                </Text>
              </Pressable>
            )}
          </ImageBackground>
          {launching && (
            <Animated.View style={[styles.launch, { opacity: launchOpacity }]}>
              <ImageBackground
                source={require("../assets/images/screen-background/splash-premium.png")}
                style={styles.launchArt}
                resizeMode="cover"
                onLoadEnd={() =>
                  setLoadedArt((value) => ({ ...value, dawn: true }))
                }
              >
                <View style={styles.launchShade} />
                <Image
                  source={require("../assets/images/splash-pick.png")}
                  style={styles.launchMark}
                  resizeMode="contain"
                  onLoadEnd={() =>
                    setLoadedArt((value) => ({ ...value, mark: true }))
                  }
                />
                <Image
                  source={require("../assets/images/splash-wordmark.png")}
                  style={styles.launchWordmark}
                  resizeMode="contain"
                  onLoadEnd={() =>
                    setLoadedArt((value) => ({ ...value, wordmark: true }))
                  }
                />
              </ImageBackground>
            </Animated.View>
          )}
        </TunerReadyContext.Provider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
};

const styles = StyleSheet.create({
  launch: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.splash.background
  },
  launchArt: { flex: 1, alignItems: "center", justifyContent: "center" },
  launchShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.splash.shade
  },
  launchMark: { width: 152, height: 152 },
  launchWordmark: { width: 224, height: 64, marginTop: 8 },
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
