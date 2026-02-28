import { StyleSheet, View } from "react-native";
import LocaleButton from "../locales/button";
import React from "react";

const Home: React.FC = () => {
  return (
    <View style={styles.overlay}>
      <LocaleButton />
    </View>
  );
};
const styles = StyleSheet.create({
  overlay: { flex: 1, width: "100%" }
});
export default Home;
