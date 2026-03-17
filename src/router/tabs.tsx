// src/router/tabs.tsx
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import React from "react";
import Header from "../components/header";
import screens from "../screens";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import palette from "../theme/palette";
import { t } from "@/locales";

const Tab = createBottomTabNavigator();

const TabLayout = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => {
        const icon = screens?.[route.name as keyof typeof screens]?.icon;
        return {
          header: ({ options }) => <Header title={options.title} icon={icon} />,
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name={icon} size={size} color={color} />
          ),
          ...styles
        };
      }}
    >
      {Object.entries(screens).map(([name]) => (
        <Tab.Screen
          key={name}
          name={name}
          component={screens[name].component}
          options={{ title: t(name) }}
        />
      ))}
    </Tab.Navigator>
  );
};
const styles = {
  sceneStyle: { backgroundColor: palette.colors.transparent },
  tabBarStyle: { backgroundColor: palette.colors.blackOpacity, elevation: 0 },
  tabBarActiveTintColor: "#FF6600",
  tabBarInactiveTintColor: "white"
};

export default TabLayout;
