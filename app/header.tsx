import Logo from "@/assets/images/guitar-pick.svg";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native"; // импортируем хук
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

interface HeaderProps {
  title: string;
  showBack?: boolean; // флаг для отображения кнопки назад
  icon?: string;
}

const Header: React.FC<HeaderProps> = ({ title, showBack = false, icon }) => {
  const navigation = useNavigation();

  return (
    <View style={styles.container}>
      <View style={styles.left}>
        {showBack && (
          <Pressable
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={28} color="#FF6600" />
          </Pressable>
        )}
        <Logo width={50} height={50} />
      </View>

      <Text style={styles.title}>{title}</Text>

      {icon ? (
        <Ionicons name={icon as any} size={35} color="#FF6600" />
      ) : (
        <View style={{ width: 35 }} /> // чтобы иконка справа не прыгала
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingTop: 40,
    backgroundColor: "rgba(20,20,20,0.55)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderColor: "rgba(255,255,255,0.15)"
  },
  left: { flexDirection: "row", alignItems: "center" },
  backButton: { marginRight: 8 },
  title: { fontSize: 18, fontWeight: "bold", color: "#FF6600" }
});

export default Header;
