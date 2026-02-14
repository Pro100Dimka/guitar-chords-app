import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import React from "react";
import { useTranslation } from "react-i18next";
import Header from "./header";
import CreateChordSong from "./screens/create";
import Home from "./screens/home";

const Tab = createBottomTabNavigator();

const SearchScreen = () => null;
const LibraryScreen = () => null;
const icons = {
  Home: "home-outline",
  Search: "search-outline",
  Library: "book-outline",
  Create: "add-circle-outline"
} as const;
const Tabs = () => {
  const { t } = useTranslation();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        header: () => (
          <Header
            title={t(route.name)}
            onProfilePress={() => console.info("Profile pressed")}
          />
        ),
        sceneStyle: { backgroundColor: "transparent" },
        headerTransparent: true,
        tabBarIcon: ({ color, size }) => (
          <Ionicons
            name={icons[route.name as keyof typeof icons]}
            size={size}
            color={color}
          />
        ),
        tabBarActiveTintColor: "#FF6600",
        tabBarInactiveTintColor: "#555"
      })}
    >
      <Tab.Screen name="Home" component={Home} options={{ title: t("Home") }} />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{ title: t("Search") }}
      />
      <Tab.Screen
        name="Library"
        component={LibraryScreen}
        options={{ title: t("Library") }}
      />
      <Tab.Screen
        name="Create"
        component={CreateChordSong}
        options={{ title: t("Create") }}
      />
    </Tab.Navigator>
  );
};
export default Tabs;
