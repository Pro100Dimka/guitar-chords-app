import { useEffect, useRef, useState } from "react";
import {
  GestureResponderEvent,
  Pressable,
  StyleSheet,
  View
} from "react-native";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import { useTranslation } from "react-i18next";
import Text from "../../components/styled-text";
import palette from "../../theme/palette";
import { MIN_GUITAR_ZOOM } from "../tuner/guitar-layout";

const inset = 14;

export function GuitarZoom({
  value,
  maximum,
  compact = false,
  onChange,
  onCommit,
  onInteractionChange
}: {
  value: number;
  maximum: number;
  compact?: boolean;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  onInteractionChange: (active: boolean) => void;
}) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  const dragging = useRef(false);
  const latest = useRef(value);
  const callbacks = useRef({ onCommit, onInteractionChange });
  callbacks.current = { onCommit, onInteractionChange };
  if (!dragging.current) latest.current = value;
  useEffect(
    () => () => {
      // Rotation moves this control between the portrait row and landscape bar.
      // Release its input lock even if the native responder never sends an end.
      if (!dragging.current) return;
      dragging.current = false;
      callbacks.current.onCommit(latest.current);
      callbacks.current.onInteractionChange(false);
    },
    []
  );
  const clamp = (next: number) =>
    Math.max(MIN_GUITAR_ZOOM, Math.min(maximum, Math.round(next * 100) / 100));
  const update = (event: GestureResponderEvent) => {
    if (width <= inset * 2) return;
    const position = Math.max(
      0,
      Math.min(1, (event.nativeEvent.locationX - inset) / (width - inset * 2))
    );
    const next = clamp(
      MIN_GUITAR_ZOOM + position * (maximum - MIN_GUITAR_ZOOM)
    );
    if (next === latest.current) return;
    latest.current = next;
    onChange(next);
  };
  const finish = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onCommit(latest.current);
    onInteractionChange(false);
  };
  const percent = Math.round(value * 100);
  const progress = (value - MIN_GUITAR_ZOOM) / (maximum - MIN_GUITAR_ZOOM);
  const thumb = inset + Math.max(0, width - inset * 2) * progress;

  return (
    <View style={[styles.row, compact && styles.compact]}>
      <View style={styles.caption}>
        {!compact && (
          <Text numberOfLines={1} style={styles.label}>
            {t("GuitarZoom")}
          </Text>
        )}
        <Text style={styles.value}>{percent}%</Text>
      </View>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t("GuitarZoom")}
        accessibilityHint={t("GuitarZoomHint")}
        accessibilityValue={{
          min: MIN_GUITAR_ZOOM * 100,
          max: Math.round(maximum * 100),
          now: percent,
          text: `${percent}%`
        }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={({ nativeEvent }) => {
          const direction =
            nativeEvent.actionName === "increment"
              ? 1
              : nativeEvent.actionName === "decrement"
                ? -1
                : 0;
          if (!direction) return;
          const next = clamp(value + direction * 0.05);
          onChange(next);
          onCommit(next);
        }}
        onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => {
          dragging.current = true;
          onInteractionChange(true);
          update(event);
        }}
        onResponderMove={(event) => {
          if (dragging.current) update(event);
        }}
        onResponderRelease={(event) => {
          update(event);
          finish();
        }}
        onResponderTerminate={finish}
        onResponderTerminationRequest={() => false}
        style={styles.slider}
      >
        <View pointerEvents="none" style={styles.track} />
        <View
          pointerEvents="none"
          style={[styles.fill, { width: Math.max(0, thumb - inset) }]}
        />
        <View
          pointerEvents="none"
          style={[styles.thumb, { left: thumb - 12 }]}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("GuitarZoomReset")}
        disabled={value === 1}
        onPress={() => {
          onChange(1);
          onCommit(1);
        }}
        style={[styles.reset, value === 1 && styles.disabled]}
      >
        <MaterialCommunityIcons
          name="restore"
          size={20}
          color={palette.glass.accent}
        />
        <Text style={styles.resetText}>100%</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.glass.surfaceEdge
  },
  compact: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 0,
    borderBottomWidth: 0
  },
  caption: { maxWidth: 120, flexShrink: 1 },
  label: { color: palette.glass.muted, fontSize: 11 },
  value: {
    color: palette.finish.highlight,
    fontSize: 14,
    fontWeight: "600",
    fontVariant: ["tabular-nums"]
  },
  slider: { flex: 1, minWidth: 88, height: 44, justifyContent: "center" },
  track: {
    position: "absolute",
    left: inset,
    right: inset,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.glass.edge
  },
  fill: {
    position: "absolute",
    left: inset,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.glass.accent
  },
  thumb: {
    position: "absolute",
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: palette.glass.accent,
    borderWidth: 2,
    borderColor: palette.gold.ink
  },
  reset: {
    minWidth: 48,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  resetText: { color: palette.glass.muted, fontSize: 10 },
  disabled: { opacity: 0.4 }
});
