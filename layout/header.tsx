import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native"; // импортируем хук
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Logo from "../assets/images/guitar-pick.svg";
import { COLORS } from "../components/fields/text-field";

interface HeaderProps {
  title: string;
  showBack?: boolean; // флаг для отображения кнопки назад
  icon?: string;
  children?: React.ReactNode;
}

const Header: React.FC<HeaderProps> = ({
  title,
  showBack = false,
  icon,
  children
}) => {
  const navigation = useNavigation();

  return (
    <View style={styles.container}>
      <View style={styles.left}>
        {showBack && (
          <Pressable
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <MaterialCommunityIcons
              name="skip-backward"
              size={28}
              color={COLORS.accent}
            />
          </Pressable>
        )}
        <Logo width={50} height={50} />
      </View>

      <Text style={styles.title}>{title}</Text>

      {icon ? (
        <MaterialCommunityIcons
          name={icon as any}
          size={35}
          color={COLORS.accent}
        />
      ) : (
        <View style={styles.viewIco} /> // чтобы иконка справа не прыгала
      )}
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  viewIco: { width: 35 },
  container: {
    paddingTop: 40,
    backgroundColor: COLORS.blackOpacity,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderColor: COLORS.placeholder
  },
  left: { flexDirection: "row", alignItems: "center" },
  backButton: { marginRight: 8 },
  title: { fontSize: 18, fontWeight: "bold", color: COLORS.accent }
});

export default Header;
