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
  glass: {
    header: "rgba(250,247,242,0.82)",
    surface: "rgba(250,247,242,0.72)",
    edge: "rgba(250,247,242,0.72)",
    surfaceEdge: "rgba(250,247,242,0.64)",
    control: "rgba(250,247,242,0.42)",
    selected: "rgba(125,87,52,0.14)",
    accent: "#836348",
    muted: "#48423B",
    cell: "rgba(250,247,242,0.66)",
    ink: "#302E2B",
    card: "rgba(250,247,242,0.32)",
    activeCard: "rgba(250,247,242,0.48)",
    diagram: "rgba(250,247,242,0.52)",
    play: "#61442F"
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
    background: "#FFF8ED",
    translucent: "rgba(255,248,237,0.95)",
    line: "#E5D6BD",
    soft: "#F2E7D4",
    green: "#456B4C"
  },
  chromatic: {
    ink: "#382B1E",
    muted: "#81715C",
    brass: "#B9955D",
    panel: "rgba(43,29,18,0.9)",
    border: "rgba(229,201,154,0.5)",
    selected: "#EED8AF",
    secondary: "#D8C5A7"
  },
  primary: PRIMARY,
  secondary: SECONDARY,
  error: ERROR,
  colors: COLORS,
  tuner: TUNER
};
export default palette;
