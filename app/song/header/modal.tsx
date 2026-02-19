import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
interface ISongModalProps {
  setIsEdit: (_: boolean) => void;
}

const SongModal: React.FC<ISongModalProps> = ({ setIsEdit }) => {
  const { t } = useTranslation();
  const [menuVisible, setMenuVisible] = useState(false);
  const openMenu = () => setMenuVisible(true);
  const closeMenu = () => setMenuVisible(false);
  const menuItems: [string, () => void][] = [[t`Edit`, () => setIsEdit(true)]];
  return (
    <>
      <Pressable onPress={openMenu} style={styles.menuButton}>
        <Ionicons name="ellipsis-vertical" size={28} color="#FF6600" />
      </Pressable>
      <Modal visible={menuVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={closeMenu}>
          <View style={styles.menu}>
            {menuItems.map(([label, action], index) => (
              <TouchableOpacity
                key={index}
                onPress={() => {
                  action();
                  closeMenu();
                }}
              >
                <Text style={styles.menuItem}>{label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => closeMenu()}>
              <Text style={styles.menuItem}>Настройки</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </>
  );
};
const styles = StyleSheet.create({
  menuButton: { marginLeft: 8 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
    justifyContent: "flex-start",
    alignItems: "flex-end"
  },
  menu: {
    backgroundColor: "#141414",
    marginTop: 80,
    marginRight: 16,
    borderRadius: 8,
    paddingVertical: 8,
    width: 150
  },
  menuItem: {
    color: "#fff",
    paddingVertical: 10,
    paddingHorizontal: 16,
    fontSize: 16
  }
});

export default SongModal;
