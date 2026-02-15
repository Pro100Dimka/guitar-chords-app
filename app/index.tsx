import backgroundImage from "@/assets/images/guitar-background.jpg";
import { initDB } from "@/database";
import Tabs from "@/layout/tabs";
import { initLanguage } from "@/locales";
import { useEffect } from "react";
import { ImageBackground, StatusBar, StyleSheet, View } from "react-native";

export default function Index() {
  useEffect(() => {
    initLanguage();
    initDB();
  }, []);
  return (
    <ImageBackground
      source={backgroundImage}
      style={styles.background}
      resizeMode="cover"
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.overlay} />
      <Tabs />
    </ImageBackground>
  );
}
const styles = StyleSheet.create({
  background: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)"
  }
});
