import React, { FC, useEffect, useState } from "react";
import { ImageBackground, Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SystemBars } from "react-native-edge-to-edge";
import Router from "./router";
import backgroundImage from "../assets/images/screen-background/background.jpg";
import palette from "./theme/palette";
import { initLanguage } from "./locales";
import { initDatabase } from "./components/database";
import SplashScreen from "react-native-splash-screen";

const App: FC = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const init = async () => {
      await initDatabase(); // дождались создания таблиц
      await initLanguage();
      setReady(true); // можно рендерить Router
    };
    init();
  }, []);
  useEffect(() => {
    if (!ready && Platform.OS === "android") SplashScreen.hide();
  }, [ready]);

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

export default App;
