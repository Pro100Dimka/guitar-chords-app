// src/components/header.tsx
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import { useNavigation } from "@react-navigation/native";
import React from "react";
import { Pressable, StyleSheet, Text, View, Image } from "react-native";
import logo from "../../assets/images/icon.png";
import palette from "../theme/palette";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "@/locales";

interface HeaderProps {
  title: string | undefined;
  showBack?: boolean;
  glass?: boolean;
  icon?: string;
  children?: React.ReactNode;
}

const Header: React.FC<HeaderProps> = ({
  title,
  showBack = false,
  glass = false,
  icon,
  children
}) => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.container,
        glass && styles.glass,
        { paddingTop: insets.top + 8 }
      ]}
    >
      <View style={styles.left}>
        {showBack && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Back")}
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <MaterialCommunityIcons
              name="chevron-left"
              size={28}
              color={glass ? palette.glass.ink : palette.chromatic.ink}
            />
          </Pressable>
        )}
        <Image source={logo} style={styles.viewIco} />
      </View>
      <Text
        numberOfLines={2}
        style={[styles.title, glass && styles.glassTitle]}
      >
        {title}
      </Text>
      {icon ? (
        <MaterialCommunityIcons
          name={icon}
          size={26}
          color={glass ? palette.glass.accent : palette.chromatic.brass}
        />
      ) : (
        !children && <View style={styles.viewIco} />
      )}
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  glass: {
    backgroundColor: palette.glass.header,
    borderColor: palette.glass.edge
  },
  glassTitle: { color: palette.glass.ink },
  viewIco: { width: 38, height: 38 },
  container: {
    backgroundColor: palette.paper.translucent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: palette.paper.line
  },
  left: { flexDirection: "row", alignItems: "center" },
  backButton: { minWidth: 44, minHeight: 44, justifyContent: "center" },
  title: {
    flex: 1,
    marginHorizontal: 12,
    fontSize: 17,
    fontWeight: "600",
    color: palette.chromatic.ink
  }
});

export default Header;
