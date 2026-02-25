import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { COLORS } from "../../components/fields/text-field";
import { deleteData } from "../../database";
interface ISongModalProps {
  setIsEdit: (_: boolean) => void;
  songId: number;
}

const SongModal: FC<ISongModalProps> = ({ setIsEdit, songId }) => {
  const { t } = useTranslation();
  const [menuVisible, setMenuVisible] = useState(false);
  const menuItems: [string, () => void][] = [
    [t`Edit`, () => setIsEdit(true)],
    [
      t`Delete`,
      async () => {
        await deleteData("songs", { id: songId })
          .then(() => {
            alert(t`ElementDeleted`);
            router.replace("/(tabs)/library");
          })
          .catch((err) => console.error(err));
      }
    ]
  ];
  return (
    <>
      <Pressable onPress={() => setMenuVisible(true)} style={styles.menuButton}>
        <Ionicons name="ellipsis-vertical" size={28} color="#FF6600" />
      </Pressable>
      <Modal visible={menuVisible} transparent animationType="fade">
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setMenuVisible(false)}
        >
          <View style={styles.menu}>
            {menuItems.map(([label, action], index) => (
              <TouchableOpacity
                key={index}
                onPress={() => {
                  action();
                  setMenuVisible(false);
                }}
              >
                <Text style={styles.menuItem}>{label}</Text>
              </TouchableOpacity>
            ))}
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
    backgroundColor: COLORS.blackOpacityTiny,
    justifyContent: "flex-start",
    alignItems: "flex-end"
  },
  menu: {
    backgroundColor: COLORS.blackOpacity,
    marginTop: 80,
    marginRight: 16,
    borderRadius: 8,
    paddingVertical: 8,
    width: 150
  },
  menuItem: {
    color: COLORS.text,
    paddingVertical: 10,
    paddingHorizontal: 16,
    fontSize: 16
  }
});

export default SongModal;
