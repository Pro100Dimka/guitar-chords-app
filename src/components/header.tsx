// src/components/header.tsx
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import { useNavigation } from "@react-navigation/native";
import React from "react";
import { Pressable, StyleSheet, Text, View, Image } from "react-native";
import logo from "../../assets/images/icon.png";
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
        <Image source={logo} style={styles.viewIco} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {icon ? (
        <MaterialCommunityIcons
          name={icon as any}
          size={styles.viewIco.height}
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
  viewIco: { width: 60, height: 60 },
  container: {
    backgroundColor: palette.colors.blackOpacity,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 35,
    borderColor: palette.colors.placeholder
  },
  left: { flexDirection: "row", alignItems: "center" },
  backButton: { marginRight: 8 },
  title: { fontSize: 18, fontWeight: "bold", color: palette.colors.accent }
});

export default Header;
