import LocaleButton from "@/locales/button";
import { StyleSheet, Text, View } from "react-native";

const Home = () => {
  return (
    <View style={styles.overlay}>
      <Text style={styles.text}>Edit app/index.tsx to edit this scrdeen.</Text>
      <LocaleButton />
    </View>
  );
};
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%"
  },
  text: { fontSize: 16, color: "#000" }
});
export default Home;
