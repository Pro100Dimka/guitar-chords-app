// src/router/tabs.tsx
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import React from "react";
import { StyleSheet } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets
} from "react-native-safe-area-context";
import screens from "../screens";
import {
  createBottomTabNavigator,
  type BottomTabBarButtonProps
} from "@react-navigation/bottom-tabs";
import { PlatformPressable } from "@react-navigation/elements";
import palette from "../theme/palette";
import { useTranslation } from "react-i18next";
import { usePreferences } from "@/components/preferences";
import Text from "../components/styled-text";

const Tab = createBottomTabNavigator();

const TabLayout = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const activeTab = usePreferences((state) => state.tab);
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[layout.container, activeTab === "play" && layout.playSurface]}
    >
      <Tab.Navigator
        detachInactiveScreens
        initialRouteName={usePreferences.getState().tab}
        screenListeners={({ route }) => ({
          focus: () => usePreferences.getState().update({ tab: route.name })
        })}
        screenOptions={({ route }) => {
          const icon = screens?.[route.name as keyof typeof screens]?.icon;
          return {
            headerShown: false,
            freezeOnBlur: !["tuner", "play"].includes(route.name),
            tabBarLabelPosition: "below-icon",
            tabBarActiveBackgroundColor: palette.glass.cell,
            tabBarButton: (props: BottomTabBarButtonProps) => (
              <PlatformPressable
                {...props}
                style={[props.style, layout.tabButton]}
              />
            ),
            tabBarItemStyle: {
              marginHorizontal: 3,
              marginTop: 5,
              marginBottom: 5,
              paddingVertical: 0,
              borderRadius: 14,
              overflow: "hidden"
            },
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name={icon} size={size} color={color} />
            ),
            ...styles,
            tabBarStyle: {
              ...styles.tabBarStyle,
              height: 64 + insets.bottom
            }
          };
        }}
      >
        {Object.entries(screens).map(([name]) => (
          <Tab.Screen
            key={name}
            name={name}
            component={screens[name].component}
            options={{
              title: t(screens[name].title ?? name),
              tabBarLabel: ({ color }) => (
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                  style={[layout.tabLabel, { color }]}
                >
                  {t(screens[name].title ?? name)}
                </Text>
              ),
              lazy: true
            }}
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
const layout = StyleSheet.create({
  container: { flex: 1 },
  playSurface: { backgroundColor: palette.paper.background },
  tabButton: {
    borderRadius: 14,
    paddingVertical: 4,
    justifyContent: "center",
    gap: 2
  },
  tabLabel: {
    width: "100%",
    paddingHorizontal: 2,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: "600",
    textAlign: "center"
  }
});

export default TabLayout;
