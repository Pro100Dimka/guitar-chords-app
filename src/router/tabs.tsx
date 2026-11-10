// src/router/tabs.tsx
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import React from "react";
import Header from "../components/header";
import screens from "../screens";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import palette from "../theme/palette";
import { useTranslation } from "react-i18next";
import { usePreferences } from "@/components/preferences";

const Tab = createBottomTabNavigator();

const TabLayout = () => {
  const { t } = useTranslation();
  return (
    <Tab.Navigator
      initialRouteName={usePreferences.getState().tab}
      screenListeners={({ route }) => ({
        focus: () => usePreferences.getState().update({ tab: route.name })
      })}
      screenOptions={({ route }) => {
        const icon = screens?.[route.name as keyof typeof screens]?.icon;
        return {
          header: ({ options }) => (
            <Header
              title={options.title}
              icon={icon}
              glass={route.name !== "tuner"}
            />
          ),
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name={icon} size={size} color={color} />
          ),
          ...styles,
          ...(route.name !== "tuner" && {
            tabBarStyle: {
              ...styles.tabBarStyle,
              backgroundColor: palette.glass.header,
              borderTopColor: palette.glass.edge
            },
            tabBarActiveTintColor: palette.glass.ink,
            tabBarInactiveTintColor: palette.glass.muted
          })
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
  tabBarStyle: {
    backgroundColor: palette.paper.background,
    borderTopColor: palette.paper.line,
    elevation: 0
  },
  tabBarActiveTintColor: palette.chromatic.ink,
  tabBarInactiveTintColor: palette.chromatic.muted
};

export default TabLayout;
