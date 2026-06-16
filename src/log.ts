type Level = "error" | "warn" | "info" | "debug";

const LEVEL_ORDER: Record<Level, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const COLOR: Record<Level, string> = {
  error: "\x1b[31m",
  warn: "\x1b[33m",
  info: "\x1b[36m",
  debug: "\x1b[90m",
};

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function shouldLog(level: Level, debug: boolean): boolean {
  const maxLevel = debug ? "debug" : "info";
  return LEVEL_ORDER[level] <= LEVEL_ORDER[maxLevel];
}

function formatTime(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(date.getFullYear())}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function formatMsg(level: Level, tag: string, args: unknown[]): string {
  const ts = formatTime(new Date());
  const tagPart = `${BOLD}[${tag}]${RESET}`;
  const levelPart = `${COLOR[level]}${level.toUpperCase().padEnd(5)}${RESET}`;
  const rest = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  return `${DIM}${ts}${RESET} ${levelPart} ${tagPart} ${rest}`;
}

export class Logger {
  private tag: string;
  private verbose: boolean;

  constructor(tag: string, verbose?: boolean) {
    this.tag = tag;
    this.verbose = verbose ?? (process.env.DEBUG === "true" || process.env.NODE_ENV !== "production");
  }

  error(...args: unknown[]): void {
    if (shouldLog("error", this.verbose)) console.error(formatMsg("error", this.tag, args));
  }

  warn(...args: unknown[]): void {
    if (shouldLog("warn", this.verbose)) console.warn(formatMsg("warn", this.tag, args));
  }

  info(...args: unknown[]): void {
    if (shouldLog("info", this.verbose)) console.info(formatMsg("info", this.tag, args));
  }

  debug(...args: unknown[]): void {
    if (shouldLog("debug", this.verbose)) console.log(formatMsg("debug", this.tag, args));
  }
}
