import backgroundImage from "@/assets/images/guitar-background.jpg";
import Tabs from "@/layout/tabs";
import { initLanguage } from "@/locales";
import { useEffect } from "react";
import { ImageBackground, StatusBar, StyleSheet } from "react-native";

export default function Index() {
  useEffect(() => {
    initLanguage();
  }, []);
  return (
    <ImageBackground
      source={backgroundImage}
      style={styles.background}
      resizeMode="cover"
    >
      <StatusBar barStyle="light-content" />
      <Tabs />
    </ImageBackground>
  );
}
const styles = StyleSheet.create({ background: { flex: 1 } });
