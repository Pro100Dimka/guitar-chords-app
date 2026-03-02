import { StyleSheet, Text, View } from "react-native";
import Colors from "../colors";

export const FormPicker = ({
  label,
  actions,
  onSelect,
  value
}: {
  label: string;
  actions: any[];
  onSelect: (id: string) => void;
  value: string;
}) => {
  return (
    <View style={styles.pickerRow}>
      <Text style={styles.pickerLabel}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  pickerLabel: { color: Colors.primary, fontSize: 16, flex: 1 },
  pickerRow: { flexDirection: "row", alignItems: "center" }
});
