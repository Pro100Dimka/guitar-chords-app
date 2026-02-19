import LocaleButton from "@/locales/button";
import { StyleSheet, View } from "react-native";

const Home = () => {
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
