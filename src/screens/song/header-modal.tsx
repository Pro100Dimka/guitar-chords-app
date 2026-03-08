// src/screens/song/header-modal.tsx
import Ionicons from "react-native-vector-icons/Ionicons";
import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import palette from "../../theme/palette";
import { useNavigation } from "@react-navigation/native";
import { NavigationProp } from "../../router";
import { deleteItem } from "@/components/database/crud";
interface ISongModalProps {
  setIsEdit: (_: boolean) => void;
  songId: number;
}

const SongModal: FC<ISongModalProps> = ({ setIsEdit, songId }) => {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const [menuVisible, setMenuVisible] = useState(false);
  const menuItems: [string, () => void][] = [
    [t`Edit`, () => setIsEdit(true)],
    [
      t`Delete`,
      async () => {
        await deleteItem({ tableName: "songs", filters: `id =${songId}` })
          .then(() => {
            navigation.navigate("Tabs", { screen: "library" });
            Alert.alert(t`ElementDeleted`);
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
    backgroundColor: palette.colors.blackOpacityTiny,
    justifyContent: "flex-start",
    alignItems: "flex-end"
  },
  menu: {
    backgroundColor: palette.colors.blackOpacity,
    marginTop: 80,
    marginRight: 16,
    borderRadius: 8,
    paddingVertical: 8,
    width: 150
  },
  menuItem: {
    color: palette.colors.text,
    paddingVertical: 10,
    paddingHorizontal: 16,
    fontSize: 16
  }
});

export default SongModal;
