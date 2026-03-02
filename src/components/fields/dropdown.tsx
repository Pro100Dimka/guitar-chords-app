import React, { useEffect, useState } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";

interface IDropdownProps {
  value?: string;
  options: { label: string; value: string }[];
  onSelect: (_: string) => void;
  style?: any;
}

const COLORS = {
  card: "rgba(20,20,20,0.55)",
  border: "rgba(255,255,255,0.15)",
  text: "#fff",
  placeholder: "#aaa"
};

const Dropdown: React.FC<IDropdownProps> = ({
  value,
  options,
  onSelect,
  style
}) => {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (value) {
      setSelected(value);
    }
  }, [value]);

  const handleSelect = (item: string) => {
    setSelected(item);
    setOpen(false);
    onSelect(item);
  };
  const selectedOption = options.find((o) => o.value === selected);
  return (
    <View style={[styles.container, style?.container]}>
      <View style={styles.pickerCard}>
        <TouchableOpacity style={styles.picker} onPress={() => setOpen(!open)}>
          {typeof selectedOption?.label === "string" ? (
            <Text style={{ color: COLORS.text }}>{selectedOption.label}</Text>
          ) : (
            selectedOption?.label
          )}
        </TouchableOpacity>
      </View>
      {open && (
        <View style={styles.dropdown}>
          <FlatList
            data={options}
            keyExtractor={(_, index) => index.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.option}
                onPress={() => handleSelect(item.value)}
              >
                <Text style={styles.optionText}>{item.label}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: 200,
    alignItems: "center",
    marginTop: 20
  },
  pickerCard: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    overflow: "hidden"
  },
  picker: {
    width: "100%",
    minHeight: 50,
    justifyContent: "center",
    alignItems: "center"
  },
  dropdown: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    marginTop: 5,
    maxHeight: 200
  },
  option: {
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border
  },
  optionText: {
    fontSize: 16,
    color: COLORS.text
  }
});

export default Dropdown;
