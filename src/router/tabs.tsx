// src/router/tabs.tsx
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import React from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import screens from "../screens";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import palette from "../theme/palette";
import { useTranslation } from "react-i18next";
import { usePreferences } from "@/components/preferences";

const Tab = createBottomTabNavigator();

const TabLayout = () => {
  const { t } = useTranslation();
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={layout.container}>
      <Tab.Navigator
        initialRouteName={usePreferences.getState().tab}
        screenListeners={({ route }) => ({
          focus: () => usePreferences.getState().update({ tab: route.name })
        })}
        screenOptions={({ route }) => {
          const icon = screens?.[route.name as keyof typeof screens]?.icon;
          return {
            headerShown: false,
            tabBarLabelStyle: {
              fontSize: 12,
              fontFamily: palette.typography.strong,
              fontWeight: "600",
              marginBottom: 4
            },
            tabBarItemStyle: { paddingTop: 6 },
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
              tabBarActiveTintColor: palette.glass.accent,
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
    </SafeAreaView>
  );
};
const styles = {
  sceneStyle: { backgroundColor: palette.colors.transparent },
  tabBarStyle: {
    backgroundColor: palette.glass.header,
    borderTopColor: palette.glass.edge,
    elevation: 0
  },
  tabBarActiveTintColor: palette.glass.accent,
  tabBarInactiveTintColor: palette.chromatic.muted
};
const layout = StyleSheet.create({ container: { flex: 1 } });

export default TabLayout;
