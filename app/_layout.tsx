import Header from "@/app/header";
import backgroundImage from "@/assets/images/guitar-background.jpg";
import { Stack } from "expo-router";
import { ImageBackground, StatusBar, StyleSheet, View } from "react-native";

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
          contentStyle: { backgroundColor: "transparent" },

          // 🔥 Вот тут подключаем твой Header
          header: ({ options, route }) => (
            <Header
              title={(options.title as string) ?? route.name}
              icon={(options as any).icon}
            />
          )
        }}
      />
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
