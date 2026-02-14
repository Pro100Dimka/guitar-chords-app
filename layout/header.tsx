import logo from "@/assets/images/guitar-pick.png";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface HeaderProps {
  title: string;
  onProfilePress: () => void;
}

const Header: React.FC<HeaderProps> = ({ title, onProfilePress }) => {
  return (
    <View style={styles.container}>
      <Image
        source={logo} // заменишь на свой логотип
        style={styles.logo}
      />
      <Text style={styles.title}>{title}</Text>
      <TouchableOpacity onPress={onProfilePress}>
        <Ionicons name="person-circle-outline" size={32} color="#FF6600" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: "#ddd"
  },
  logo: {
    width: 32,
    height: 32,
    resizeMode: "contain"
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333"
  }
});

export default Header;
