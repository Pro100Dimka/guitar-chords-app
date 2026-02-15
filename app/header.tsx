import Logo from "@/assets/images/guitar-pick.svg";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

interface HeaderProps {
  title: string;
  icon?: string;
}

const Header: React.FC<HeaderProps> = ({ title, icon }) => {
  return (
    <View style={styles.container}>
      <Logo width={50} height={50} />
      <Text style={styles.title}>{title}</Text>
      {icon && <Ionicons name={icon as any} size={35} color="#FF6600" />}
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
  title: { fontSize: 18, fontWeight: "bold", color: "#FF6600" }
});

export default Header;
