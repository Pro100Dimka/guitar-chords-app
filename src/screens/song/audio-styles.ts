import { StyleSheet } from "react-native";
import palette from "../../theme/palette";

export default StyleSheet.create({
  flex: { flex: 1 },
  content: {
    padding: 18,
    paddingBottom: 42,
    gap: 16,
    width: "100%",
    maxWidth: 800,
    alignSelf: "center"
  },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  card: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: palette.glass.card,
    borderWidth: 1,
    borderColor: palette.glass.surfaceEdge,
    gap: 12
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: palette.glass.edge,
    borderRadius: 12,
    padding: 12,
    color: palette.glass.ink,
    backgroundColor: palette.glass.control,
    fontSize: 16
  },
  timeInput: { width: 110 },
  title: { color: palette.glass.ink, fontSize: 20, fontWeight: "600" },
  text: { color: palette.glass.ink, fontSize: 17, lineHeight: 27 },
  muted: { color: palette.glass.muted, fontSize: 14, lineHeight: 22 },
  error: { color: "#ffb59f", fontSize: 15, lineHeight: 23 },
  gold: { color: palette.glass.accent },
  clock: {
    color: palette.glass.ink,
    fontSize: 17,
    fontVariant: ["tabular-nums"]
  },
  line: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.colors.transparent,
    gap: 6
  },
  active: {
    borderColor: palette.glass.accent,
    backgroundColor: palette.glass.activeCard
  },
  wordActive: { color: palette.gold.ink, backgroundColor: palette.gold.center },
  uncertain: { textDecorationLine: "underline", textDecorationStyle: "dotted" },
  time: {
    color: palette.glass.muted,
    fontSize: 12,
    fontVariant: ["tabular-nums"]
  },
  progress: {
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.glass.edge,
    overflow: "hidden"
  },
  progressFill: { height: "100%", backgroundColor: palette.gold.center },
  playback: {
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderColor: palette.glass.edge,
    backgroundColor: palette.glass.header
  },
  timeline: { minHeight: 44, justifyContent: "center" },
  currentChord: {
    color: palette.glass.accent,
    fontSize: 28,
    fontWeight: "600"
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: palette.glass.control,
    borderWidth: 1,
    borderColor: palette.glass.edge
  },
  actions: { justifyContent: "space-between" }
});
