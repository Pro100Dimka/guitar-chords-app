import { Stack } from "expo-router";
import { ImageBackground, StatusBar, StyleSheet, View } from "react-native";
import { COLORS } from "../components/fields/text-field";
const backgroundImage = require("../assets/images/guitar-background.jpg");

export default function RootLayout() {
  return (
    <ImageBackground
      source={backgroundImage}
      style={styles.background}
      resizeMode="cover"
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.overlay} />
      <Stack
        screenOptions={{
          animationTypeForReplace: "pop",
          headerShown: false,
          contentStyle: { backgroundColor: COLORS.transparent, flex: 1 }
        }}
      />
    </ImageBackground>
  );
}
const styles = StyleSheet.create({
  background: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.blackOpacityTiny
  }
});
