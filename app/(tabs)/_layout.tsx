import { COLORS } from "@/components/fields/text-field";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import Header from "../../layout/header";
import CreateChordSong from "./createSong";
import Home from "./home";
import Library from "./library";

export type TabParamList = {
  home: undefined;
  library: undefined;
  createSong: undefined;
};

export interface TabProps {
  component: React.ComponentType<any>;
  icon: keyof typeof Ionicons.glyphMap;
}

export const screens: Record<keyof TabParamList, TabProps> = {
  home: { component: Home, icon: "home-outline" },
  library: { component: Library, icon: "book-outline" },
  createSong: {
    component: CreateChordSong,
    icon: "add-circle-outline"
  }
};

const TabLayout = () => {
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        header: ({ options }) => {
          const item: any = screens?.[route.name as keyof TabParamList];
          return <Header title={options.title as string} icon={item?.icon} />;
        },
        tabBarIcon: ({ color, size }) => (
          <Ionicons
            name={screens?.[route.name as keyof TabParamList]?.icon}
            size={size}
            color={color}
          />
        ),
        sceneStyle: { backgroundColor: COLORS.transparent },
        tabBarActiveTintColor: "#FF6600",
        tabBarStyle: { backgroundColor: COLORS.blackOpacity },
        tabBarInactiveTintColor: "white"
      })}
    >
      {Object.entries(screens).map(([name]) => (
        <Tabs.Screen key={name} name={name} options={{ title: t(name) }} />
      ))}
    </Tabs>
  );
};

export default TabLayout;
