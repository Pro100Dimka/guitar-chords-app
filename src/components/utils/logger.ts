// src/utils/logger.ts
/* eslint-disable no-console */
import { logger, transportFunctionType } from "react-native-logs";

type ConsoleLevel = "error" | "warn" | "info" | "debug";
interface IConsoleConfig {
  color: string;
  fn: (..._: any[]) => void;
}

const DEFAULT_LEVEL: ConsoleLevel = "debug";
const RESET = "\x1b[0m";
const MAX_LINES = 8;

const LEVELS: Record<ConsoleLevel, IConsoleConfig> = {
  error: { color: "\x1b[31m", fn: console.error },
  warn: { color: "\x1b[33m", fn: console.warn },
  info: { color: "\x1b[36m", fn: console.info },
  debug: { color: "\x1b[36m", fn: console.debug }
};

const stackTransport: transportFunctionType<any> = ({ level, msg }) => {
  const lvl = level.text in LEVELS ? level.text : DEFAULT_LEVEL;
  const { color, fn } = LEVELS[lvl as ConsoleLevel];
  const lines = msg.split("\n").map((l) => l.trim());
  if (!lines.length) return;
  const [firstLine, ...rest] = lines;
  const displayedRest = rest.slice(0, MAX_LINES).join(" ");
  const remaining = rest.length - MAX_LINES;
  fn(
    `\n     ${color}${firstLine}${RESET}\n   ${color}${displayedRest}${
      remaining > 0 ? ` ... +${remaining} more lines` : ""
    }${RESET}\n`
  );
};

const log = logger.createLogger({
  transport: stackTransport,
  severity: "debug"
});

const mapArgs = (args: unknown[]) =>
  args
    .map((a) =>
      a instanceof Error
        ? a.stack || a.message
        : typeof a === "object"
          ? JSON.stringify(a)
          : String(a)
    )
    .join(" ");
(Object.keys(LEVELS) as ConsoleLevel[]).forEach((lvl) => {
  console[lvl] = (...args) => log[lvl](mapArgs(args));
});
