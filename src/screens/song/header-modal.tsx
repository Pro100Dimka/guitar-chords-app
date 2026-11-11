// src/screens/song/header-modal.tsx
import Ionicons from "react-native-vector-icons/Ionicons";
import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View
} from "react-native";
import Text from "../../components/styled-text";
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("SongTools")}
        onPress={() => setMenuVisible(true)}
        style={styles.menuButton}
      >
        <Ionicons
          name="ellipsis-vertical"
          size={28}
          color={palette.glass.ink}
        />
      </Pressable>
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
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
  menuButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: palette.finish.scrim,
    justifyContent: "flex-start",
    alignItems: "flex-end"
  },
  menu: {
    backgroundColor: palette.glass.header,
    marginTop: 80,
    marginRight: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    paddingVertical: 8,
    width: 220
  },
  menuItem: {
    color: palette.glass.ink,
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16
  }
});

export default SongModal;
