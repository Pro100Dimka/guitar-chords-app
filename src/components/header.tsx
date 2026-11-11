// src/components/header.tsx
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import { useNavigation } from "@react-navigation/native";
import React from "react";
import LinearGradient from "react-native-linear-gradient";
import { Pressable, StyleSheet, View } from "react-native";
import Text from "./styled-text";
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
        { marginTop: insets.top + 8 }
      ]}
    >
      <LinearGradient
        pointerEvents="none"
        colors={palette.finish.surfaceColors}
        locations={palette.finish.locations}
        style={styles.sheen}
      />
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
  sheen: { ...StyleSheet.absoluteFillObject, borderRadius: 18 },
  glass: {
    backgroundColor: palette.glass.control,
    borderColor: palette.glass.edge
  },
  glassTitle: { color: palette.glass.ink },
  viewIco: { width: 38, height: 38 },
  container: {
    backgroundColor: palette.paper.translucent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 6,
    gap: 4,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 18,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: palette.paper.line
  },
  left: { flexDirection: "row", alignItems: "center" },
  backButton: { minWidth: 44, minHeight: 44, justifyContent: "center" },
  title: {
    flex: 1,
    marginHorizontal: 2,
    fontSize: 17,
    fontWeight: "600",
    color: palette.chromatic.ink
  }
});

export default Header;
