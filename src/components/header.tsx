// src/components/header.tsx
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Logo from "../../assets/images/guitar-pick.svg";
import palette from "../theme/palette";

interface HeaderProps {
  title: string | undefined;
  showBack?: boolean;
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
              color={palette.colors.accent}
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
          color={palette.colors.accent}
        />
      ) : (
        <View style={styles.viewIco} />
      )}
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  viewIco: { width: 35 },
  container: {
    backgroundColor: palette.colors.blackOpacity,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderColor: palette.colors.placeholder
  },
  left: { flexDirection: "row", alignItems: "center" },
  backButton: { marginRight: 8 },
  title: { fontSize: 18, fontWeight: "bold", color: palette.colors.accent }
});

export default Header;
