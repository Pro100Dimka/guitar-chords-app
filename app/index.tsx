import backgroundImage from "@/assets/images/guitar-background.jpg";
import Header from "@/layout/header";
import { initLanguage } from "@/locales";
import LocaleButton from "@/locales/button";
import { useEffect } from "react";
import {
  ImageBackground,
  StatusBar,
  StyleSheet,
  Text,
  View
} from "react-native";

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
      <View style={styles.overlay}>
        <StatusBar barStyle="dark-content" />
        <Header />
        <Text style={styles.text}>
          Edit app/index.tsx to edit this scrdeen.
        </Text>
        <LocaleButton />
      </View>
    </ImageBackground>
  );
}
const styles = StyleSheet.create({
  background: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center"
  },
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    width: "100%"
  },
  text: { fontSize: 16, color: "#000" }
});
