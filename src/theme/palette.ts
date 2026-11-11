const PRIMARY = {
  main: "#4CAF50"
};
const SECONDARY = {
  main: "#2196F3"
};
const ERROR = {
  main: "#f44336"
};

const COLORS = {
  input: "rgba(0,0,0,0.35)",
  label: "#dddddd",
  text: "#ffffff",
  placeholder: "#aaaaaa",
  red: "#ff0000",
  white: "#ffffff",
  gray: "#aaaaaa",
  accent: "#FF6600",
  background: "#eeeeee",
  black: "#000000",
  grayOpacity: "rgba(255,255,255,0.35)",
  grayOpacityTiny: "rgba(255,255,255,0.15)",
  blackOpacity: "rgba(20,20,20,0.55)",
  blackOpacityTiny: "rgba(0,0,0,0.25)",
  transparent: "#00000000",
  bgInactive: "#222222",
  bgActive: "#333333",
  bgTitle: "#222222",
  secondary: "#7a7a7a",
  primary: "#ffffff",
  bgLight: "#ffffff",
  fgLight: "#000000",
  ok: "rgb(120, 255, 0)",
  warn: "rgb(255, 60, 0)"
};
const TUNER = {
  low: "rgb(255, 60, 0)",
  high: "rgb(255, 60, 0)",
  center: "rgb(59, 126, 0)",
  lowTuple: [255, 60, 0],
  highTuple: [255, 60, 0],
  centerTuple: [120, 255, 0]
};
const palette = {
  typography: { body: "Manrope-Regular", strong: "Manrope-SemiBold" },
  finish: {
    dot: "#655536",
    edge: "#73644B",
    silver: "#6F7778",
    highlight: "#FFE59C",
    glow: "#FF9D00",
    scrim: "rgba(0,0,0,0.76)",
    surfaceColors: [
      "rgba(107,119,123,0.92)",
      "rgba(44,57,63,0.92)",
      "rgba(23,33,38,0.94)",
      "rgba(10,17,22,0.94)",
      "rgba(38,49,54,0.92)"
    ],
    goldColors: ["#FFF8D9", "#FFE8A2", "#F6CC59", "#D49A21", "#F8D46D"],
    locations: [0, 0.12, 0.47, 0.53, 1]
  },
  recorder: { body: "#0B1014", rim: "#879297", coreEdge: "#FFB49E" },
  gold: {
    rimLight: "#FFF9DE",
    rimShade: "#A27422",
    top: "#FFE89B",
    center: "#FFC21C",
    bottom: "#DD8B00",
    ink: "#191103",
    glow: "#FFB000"
  },
  glass: {
    header: "rgba(8,14,17,0.94)",
    surface: "rgba(6,11,14,0.82)",
    edge: "rgba(218,177,97,0.30)",
    surfaceEdge: "rgba(218,177,97,0.20)",
    control: "#0B1012",
    selected: "#FFC21C",
    accent: "#FFD04A",
    muted: "#BCC0BD",
    cell: "rgba(255,202,67,0.09)",
    ink: "#F5F3E9",
    card: "rgba(10,17,21,0.72)",
    activeCard: "rgba(255,186,24,0.035)",
    diagram: "rgba(7,12,15,0.92)",
    play: "#FFD04A"
  },
  guitarDial: {
    center: "#493320",
    edge: "#20170F",
    rim: "#B9955D",
    engraving: "#CCB38B",
    note: "#FFF4DE",
    tuned: "#B5C9A0",
    track: "rgba(204,179,139,0.38)",
    highlight: "rgba(255,237,202,0.18)"
  },
  paper: {
    background: "#05090C",
    translucent: "rgba(9,15,19,0.95)",
    line: "#665435",
    soft: "#10191D",
    green: "#456B4C"
  },
  chromatic: {
    ink: "#F4F3E9",
    muted: "#C0C3BE",
    brass: "#FFC52E",
    panel: "rgba(5,10,13,0.94)",
    border: "rgba(229,201,154,0.5)",
    selected: "#FFD04A",
    secondary: "#D8C5A7"
  },
  primary: PRIMARY,
  secondary: SECONDARY,
  error: ERROR,
  colors: COLORS,
  tuner: TUNER
};
export default palette;
