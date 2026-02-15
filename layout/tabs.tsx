import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import React from "react";
import { useTranslation } from "react-i18next";

import Library from "@/layout/screens/library";
import Header from "../app/header";
import CreateChordSong from "./screens/create-song-chords";
import Home from "./screens/home";

type TabParamList = {
  Home: undefined;
  Search: undefined;
  Library: undefined;
  Create: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

const SearchScreen = () => null;

const screens: Record<
  keyof TabParamList,
  { component: React.ComponentType<any>; icon: keyof typeof Ionicons.glyphMap }
> = {
  Home: { component: Home, icon: "home-outline" },
  Search: { component: SearchScreen, icon: "search-outline" },
  Library: { component: Library, icon: "book-outline" },
  Create: { component: CreateChordSong, icon: "add-circle-outline" }
};

const Tabs = () => {
  const { t } = useTranslation();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        header: ({ options }) => (
          <Header
            title={options.title as string}
            icon={screens[route.name].icon}
          />
        ),
        sceneStyle: { backgroundColor: "transparent" },
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={screens[route.name].icon} size={size} color={color} />
        ),
        tabBarActiveTintColor: "#FF6600",
        tabBarStyle: { backgroundColor: "rgba(20,20,20,0.55)" },
        tabBarInactiveTintColor: "white"
      })}
    >
      {Object.entries(screens).map(([name, screen]) => (
        <Tab.Screen
          key={name}
          name={name as keyof TabParamList}
          component={screen.component}
          options={{ title: t(name) }}
        />
      ))}
    </Tab.Navigator>
  );
};

export default Tabs;
