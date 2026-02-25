import { StyleSheet, Text, View } from "react-native";
import { COLORS } from "../../components/fields/text-field";

const Tuner = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Guitar Tuner</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.background
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: COLORS.text
  }
});

export default Tuner;
