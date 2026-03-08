import palette from "../../theme/palette";
import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
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
  const [layout, setLayout] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const ref = useRef<View>(null);
  useEffect(() => {
    if (value) setSelected(value);
  }, [value]);
  const openDropdown = () => {
    ref.current?.measureInWindow((x, y, width, height) => {
      setLayout({ x, y, width, height });
      setOpen(true);
    });
  };
  const handleSelect = (item: string) => {
    onSelect(item);
    setSelected(item);
    setOpen(false);
  };
  const selectedOption = options.find((o) => o.value === selected);
  return (
    <View style={[styles.container, style?.container]}>
      <View ref={ref}>
        <TouchableOpacity
          style={[styles.picker, style?.picker]}
          onPress={openDropdown}
        >
          <Text style={[styles.optionText, style?.optionText]}>
            {selectedOption?.label ?? "Select"}
          </Text>
        </TouchableOpacity>
      </View>

      <Modal visible={open} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setOpen(false)} />

        <View
          style={[
            styles.dropdown,
            {
              top: layout.y + layout.height + 4,
              left: layout.x,
              width: layout.width
            }
          ]}
        >
          <FlatList
            data={options}
            keyExtractor={(_, i) => i.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.option, style?.option]}
                onPress={() => handleSelect(item.value)}
              >
                <Text style={[styles.optionText, style?.optionText]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    width: "100%",
    height: "100%",
    zIndex: 1,
    pointerEvents: "box-none"
  },
  container: {
    width: 200,
    alignItems: "center",
    marginTop: 5,
    zIndex: 2
  },
  picker: {
    padding: 12,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.colors.blackOpacityTiny,
    backgroundColor: palette.colors.blackOpacity
  },
  dropdown: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    maxHeight: 200
  },
  option: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border
  },
  optionText: { fontSize: 16, color: COLORS.text }
});

export default Dropdown;
