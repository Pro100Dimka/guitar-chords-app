import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  View
} from "react-native";
import { useTranslation } from "react-i18next";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import Text from "../../components/styled-text";
import palette from "../../theme/palette";

export const TABLATURE_KEYPAD_WIDTH = 174;
export const TABLATURE_KEYPAD_TAB_WIDTH = 44;
export const TABLATURE_KEYPAD_EXPANDED_WIDTH =
  TABLATURE_KEYPAD_WIDTH + TABLATURE_KEYPAD_TAB_WIDTH;

export type TablatureKeypadKey = number | "delete" | "next";
interface Props {
  expanded: boolean;
  onToggle: () => void;
  caption: string;
  disabled: boolean;
  canDelete: boolean;
  canAdvance: boolean;
  onKey: (key: TablatureKeypadKey) => void;
}
const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, "delete", 0, "next"] as const;

/** Reserve score space once per toggle; animate only the native drawer track. */
export const TablatureKeypad = React.memo(function TablatureKeypad({
  expanded,
  onToggle,
  caption,
  disabled,
  canDelete,
  canAdvance,
  onKey
}: Props) {
  const { t } = useTranslation();
  const [progress] = useState(() => new Animated.Value(expanded ? 1 : 0));
  const [reduceMotion, setReduceMotion] = useState(true);
  const [retained, setRetained] = useState(expanded);
  const transition = useRef(0);
  const fullExtent = expanded || retained;
  const slide = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [TABLATURE_KEYPAD_WIDTH, 0]
      }),
    [progress]
  );

  useEffect(() => {
    let mounted = true;
    let changed = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => true)
      .then((value) => {
        if (mounted && !changed) setReduceMotion(value);
      });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value) => {
        changed = true;
        if (mounted) setReduceMotion(value);
      }
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const sequence = ++transition.current;
    if (expanded) setRetained(true);
    progress.stopAnimation();
    const finish = () => {
      if (sequence === transition.current && !expanded) setRetained(false);
    };
    if (reduceMotion) {
      progress.setValue(expanded ? 1 : 0);
      finish();
      return () => {
        transition.current = sequence + 1;
      };
    }
    const animation = Animated.timing(progress, {
      toValue: expanded ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    });
    animation.start(({ finished }) => {
      if (finished) finish();
    });
    return () => {
      transition.current = sequence + 1;
      animation.stop();
    };
  }, [expanded, progress, reduceMotion]);

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.dock,
        {
          width: fullExtent
            ? TABLATURE_KEYPAD_EXPANDED_WIDTH
            : TABLATURE_KEYPAD_TAB_WIDTH
        }
      ]}
    >
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.track,
          {
            // Retain layout space through the exit, then release it once.
            transform: [{ translateX: slide }]
          }
        ]}
      >
        <View pointerEvents="box-none" style={styles.rail}>
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel={t(expanded ? "TabHideKeypad" : "TabShowKeypad")}
            accessibilityState={{ expanded }}
            onPress={onToggle}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons
              accessible={false}
              name={expanded ? "chevron-right" : "chevron-left"}
              size={20}
              color={palette.glass.accent}
            />
            <View pointerEvents="none" style={styles.verticalLabel}>
              <Text
                accessible={false}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
                style={styles.tabText}
              >
                {t("TabFret")}
              </Text>
            </View>
          </Pressable>
        </View>
        <Animated.View
          pointerEvents={expanded ? "auto" : "none"}
          accessibilityElementsHidden={!expanded}
          importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
          style={[styles.panel, { opacity: progress }]}
        >
          {fullExtent && (
            <ScrollView
              bounces={false}
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
            >
              <Text numberOfLines={1} style={styles.caption}>
                {caption}
              </Text>
              <View style={styles.grid}>
                {keys.map((key) => {
                  const unavailable =
                    !expanded ||
                    disabled ||
                    (key === "delete" && !canDelete) ||
                    (key === "next" && !canAdvance);
                  return (
                    <Pressable
                      key={key}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={
                        typeof key === "number"
                          ? `${t("TabFret")}: ${key}`
                          : t(
                              key === "delete"
                                ? "TabDeleteNote"
                                : "TabNextPosition"
                            )
                      }
                      accessibilityState={{ disabled: unavailable }}
                      disabled={unavailable}
                      onPress={() => {
                        if (!unavailable) onKey(key);
                      }}
                      style={({ pressed }) => [
                        styles.key,
                        pressed && styles.pressed,
                        unavailable && styles.disabled
                      ]}
                    >
                      {typeof key === "number" ? (
                        <Text accessible={false} style={styles.digit}>
                          {key}
                        </Text>
                      ) : (
                        <MaterialCommunityIcons
                          accessible={false}
                          name={
                            key === "delete"
                              ? "backspace-outline"
                              : "arrow-right"
                          }
                          size={22}
                          color={palette.glass.accent}
                        />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </Animated.View>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  dock: { alignSelf: "stretch", flexShrink: 0, overflow: "hidden" },
  track: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: TABLATURE_KEYPAD_EXPANDED_WIDTH,
    flexDirection: "row"
  },
  rail: {
    width: TABLATURE_KEYPAD_TAB_WIDTH,
    alignItems: "center",
    justifyContent: "center"
  },
  tab: {
    width: TABLATURE_KEYPAD_TAB_WIDTH,
    minHeight: 120,
    paddingVertical: 8,
    gap: 4,
    alignItems: "center",
    justifyContent: "center",
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: palette.glass.edge,
    backgroundColor: palette.glass.control
  },
  verticalLabel: {
    width: 24,
    height: 76,
    alignItems: "center",
    justifyContent: "center"
  },
  tabText: {
    width: 80,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: palette.glass.accent,
    textAlign: "center",
    transform: [{ rotate: "-90deg" }]
  },
  panel: {
    width: TABLATURE_KEYPAD_WIDTH,
    borderLeftWidth: 1,
    borderLeftColor: palette.glass.edge,
    backgroundColor: palette.glass.control
  },
  content: { flexGrow: 1, padding: 8, gap: 6 },
  caption: {
    fontSize: 11,
    color: palette.glass.muted,
    textAlign: "center"
  },
  grid: {
    flexGrow: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "stretch",
    gap: 4
  },
  key: {
    width: "31%",
    minHeight: 44,
    flexGrow: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    backgroundColor: palette.paper.background,
    alignItems: "center",
    justifyContent: "center"
  },
  pressed: {
    backgroundColor: palette.glass.cell,
    borderColor: palette.glass.accent
  },
  disabled: { opacity: 0.4 },
  digit: {
    fontSize: 20,
    color: palette.glass.ink,
    fontVariant: ["tabular-nums"]
  }
});
