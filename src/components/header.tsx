// src/components/header.tsx
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import { useNavigation } from "@react-navigation/native";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Text from "./styled-text";
import palette from "../theme/palette";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

interface HeaderProps {
  title?: string;
  titleKey?: string;
  showBack?: boolean;
  onBack?: () => void;
  glass?: boolean;
  icon?: string;
  children?: React.ReactNode;
}

const Header: React.FC<HeaderProps> = ({
  title,
  titleKey,
  showBack = false,
  onBack,
  glass = false,
  icon,
  children
}) => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.container,
        glass && styles.glass,
        { marginTop: insets.top }
      ]}
    >
      <View style={styles.left}>
        {showBack && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Back")}
            onPress={onBack ?? (() => navigation.goBack())}
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
        {titleKey ? t(titleKey) : title}
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
    backgroundColor: palette.glass.control,
    borderColor: palette.glass.edge
  },
  glassTitle: { color: palette.glass.ink },
  viewIco: { width: 38, height: 38 },
  container: {
    backgroundColor: palette.glass.control,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    gap: 8,
    minHeight: 52,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderColor: palette.glass.surfaceEdge
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
