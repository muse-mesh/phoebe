// ── Logger ────────────────────────────────────────────────────────────────────
// Beautiful structured logging for Phoebe. Designed for readability in PM2 logs
// by both humans and AI models. Zero dependencies.
//
// Format: HH:MM:SS.mmm  ● INF  module     message  key=value key=value
//
// Features:
//   • Color-coded log levels (info/warn/error/fatal)
//   • Color-coded module names for instant visual scanning
//   • Compact ISO timestamps (ms precision)
//   • Structured key-value metadata
//   • Pretty startup banner with system info
//   • Section separators for visual grouping
//   • Safe — falls back gracefully if terminal lacks color support
//   • Optional JSON output (set JSON_LOGGING=true)

const JSON_MODE = process.env.JSON_LOGGING === "true";

// ── ANSI Escape Codes ────────────────────────────────────────────────────────

const R = "\x1b[0m"; // reset
const B = "\x1b[1m"; // bold
const D = "\x1b[2m"; // dim
const _U = "\x1b[4m"; // underline (reserved)

const FG = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  bRed: "\x1b[91m",
  bGreen: "\x1b[92m",
  bYellow: "\x1b[93m",
  bBlue: "\x1b[94m",
  bMagenta: "\x1b[95m",
  bCyan: "\x1b[96m",
  bWhite: "\x1b[97m",
} as const;

// ── Module Colors ────────────────────────────────────────────────────────────
// Each module gets a distinct color so you can visually track log flows.

const MOD_COLORS: Record<string, string> = {
  phoebe: FG.bMagenta,
  bot: FG.bCyan,
  ai: FG.bBlue,
  agent: FG.blue,
  bash: FG.green,
  readFile: FG.yellow,
  writeFile: FG.yellow,
  skills: FG.magenta,
  web: FG.bGreen,
  firestore: FG.bYellow,
  tts: FG.cyan,
  stt: FG.cyan,
  persist: FG.gray,
  models: FG.bWhite,
  model: FG.bWhite,
  voice: FG.cyan,
  voicereply: FG.cyan,
  restart: FG.red,
  FATAL: FG.bRed,
};

// ── Level Config ─────────────────────────────────────────────────────────────

type Level = "info" | "warn" | "error" | "fatal";

const LEVELS: Record<Level, { icon: string; color: string; tag: string }> = {
  info: { icon: "●", color: FG.cyan, tag: "INF" },
  warn: { icon: "▲", color: FG.yellow, tag: "WRN" },
  error: { icon: "✖", color: FG.red, tag: "ERR" },
  fatal: { icon: "☠", color: `${B}${FG.bRed}`, tag: "FTL" },
};

// ── Formatting Helpers ───────────────────────────────────────────────────────

function ts(): string {
  return `${D}${new Date().toISOString().slice(11, 23)}${R}`;
}

function fmtLevel(level: Level): string {
  const l = LEVELS[level];
  return `${l.color}${l.icon} ${l.tag}${R}`;
}

function fmtMod(mod: string): string {
  const color = MOD_COLORS[mod] ?? FG.white;
  return `${color}${B}${mod.padEnd(10)}${R}`;
}

/** Format key-value metadata inline: key=value key=value */
function fmtMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return "";
  const pairs = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => {
      const val = typeof v === "string" ? `"${v}"` : String(v);
      return `${D}${k}${R}${D}=${R}${val}`;
    });
  return pairs.length > 0 ? "  " + pairs.join(" ") : "";
}

// ── Core Log Function ────────────────────────────────────────────────────────

function emit(
  level: Level,
  mod: string,
  message: string,
  meta?: Record<string, unknown>,
  extra?: unknown[],
): void {
  if (JSON_MODE) {
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      mod,
      msg: message,
      ...meta,
    };
    if (extra && extra.length > 0) {
      entry.extra = extra.map((e) =>
        e instanceof Error ? { message: e.message, stack: e.stack } : e,
      );
    }
    console.log(JSON.stringify(entry));
    return;
  }

  const line = `${ts()}  ${fmtLevel(level)}  ${fmtMod(mod)} ${message}${fmtMeta(meta)}`;

  const fn =
    level === "error" || level === "fatal" ? console.error : console.log;

  if (extra && extra.length > 0) {
    fn(line, ...extra);
  } else {
    fn(line);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export const log = {
  /**
   * Info-level log. General operational events.
   * @example log.info("bot", "photo received", { from: 123, size: "45KB" })
   */
  info(mod: string, msg: string, meta?: Record<string, unknown>): void {
    emit("info", mod, msg, meta);
  },

  /**
   * Warning-level log. Non-fatal issues worth attention.
   * @example log.warn("models", "no API key, catalog empty")
   */
  warn(mod: string, msg: string, meta?: Record<string, unknown>): void {
    emit("warn", mod, msg, meta);
  },

  /**
   * Error-level log. Failures that affect functionality.
   * @example log.error("ai", "stream error", { err: err.message })
   */
  error(
    mod: string,
    msg: string,
    meta?: Record<string, unknown>,
    err?: unknown,
  ): void {
    if (err !== undefined) {
      emit("error", mod, msg, meta, [err]);
    } else {
      emit("error", mod, msg, meta);
    }
  },

  /**
   * Fatal-level log. Unrecoverable errors, process will exit.
   * @example log.fatal("phoebe", "unhandled rejection", {}, reason)
   */
  fatal(
    mod: string,
    msg: string,
    meta?: Record<string, unknown>,
    err?: unknown,
  ): void {
    if (err !== undefined) {
      emit("fatal", mod, msg, meta, [err]);
    } else {
      emit("fatal", mod, msg, meta);
    }
  },

  // ── Visual Helpers ───────────────────────────────────────────────────────

  /**
   * Print a horizontal separator with optional centered label.
   * @example log.separator("startup")
   */
  separator(label?: string): void {
    const width = 72;
    if (label) {
      const side = Math.max(2, Math.floor((width - label.length - 2) / 2));
      const line = "─".repeat(side);
      console.log(`${D}${line}${R} ${FG.bWhite}${label}${R} ${D}${line}${R}`);
    } else {
      console.log(`${D}${"─".repeat(width)}${R}`);
    }
  },

  /**
   * Print a startup banner with key-value pairs.
   * @example log.banner("PHOEBE v2.0.0", { bot: "@name", model: "gpt-4" })
   */
  banner(title: string, info: Record<string, string>): void {
    const width = 72;
    console.log("");
    console.log(`${D}${"─".repeat(width)}${R}`);
    console.log(`  ${FG.bMagenta}${B}◈ ${title}${R}`);
    console.log(`${D}${"─".repeat(width)}${R}`);
    for (const [key, value] of Object.entries(info)) {
      const k = `${D}${key.padEnd(12)}${R}`;
      const v = `${FG.bWhite}${value}${R}`;
      console.log(`  ${k} ${v}`);
    }
    console.log(`${D}${"─".repeat(width)}${R}`);
    console.log("");
  },

  /**
   * Print a brief inline section header.
   * @example log.section("incoming message")
   */
  section(label: string): void {
    console.log(`\n${D}──────${R} ${FG.bWhite}${B}${label}${R} ${D}──────${R}`);
  },

  // ── Verbose Helpers ──────────────────────────────────────────────────────

  /**
   * Log a multi-line text block with a labeled header. Ideal for tool output,
   * AI responses, or any long-form content. Content is indented and dim.
   * No truncation — full content is always logged for auditing.
   * @example log.block("ai", "response", fullText)
   */
  block(mod: string, label: string, content: string, _max?: number): void {
    if (!content) return;
    const header = `${ts()}  ${LEVELS.info.color}│${R}  ${fmtMod(mod)} ${D}${label}${R}`;
    console.log(header);
    for (const line of content.split("\n")) {
      console.log(`${D}  │${R} ${D}${line}${R}`);
    }
  },

  /**
   * Log tool call arguments in a structured, readable way.
   * @example log.toolCall("bash", { command: "ls -la", cwd: "/home" })
   */
  toolCall(toolName: string, args: Record<string, unknown>): void {
    const color = MOD_COLORS[toolName] ?? FG.white;
    const header = `${ts()}  ${FG.bBlue}▶ CALL${R} ${color}${B}${toolName}${R}`;
    console.log(header);
    for (const [k, v] of Object.entries(args)) {
      if (v === undefined || v === null) continue;
      const val = typeof v === "string" ? v : JSON.stringify(v);
      const lines = val.split("\n");
      if (lines.length > 1) {
        console.log(`${D}  ▶ ${k}:${R}`);
        for (const l of lines) {
          console.log(`${D}    │${R} ${D}${l}${R}`);
        }
      } else {
        console.log(`${D}  ▶ ${k}${R}${D}=${R}${val}`);
      }
    }
  },

  /**
   * Log tool result summary.
   * @example log.toolResult("bash", "success", "git version 2.43.0", 200)
   */
  toolResult(
    toolName: string,
    status: "ok" | "error",
    output: string,
    durationMs?: number,
  ): void {
    const icon =
      status === "ok" ? `${FG.green}◀ DONE${R}` : `${FG.red}◀ FAIL${R}`;
    const color = MOD_COLORS[toolName] ?? FG.white;
    const dur = durationMs !== undefined ? `  ${D}${durationMs}ms${R}` : "";
    const header = `${ts()}  ${icon} ${color}${B}${toolName}${R}${dur}  ${D}(${output?.length ?? 0}ch)${R}`;
    console.log(header);
    if (output) {
      for (const l of output.split("\n")) {
        console.log(`${D}  ◀ ${l}${R}`);
      }
    }
  },

  /**
   * Log a user message arrival with content preview.
   */
  userMessage(
    mod: string,
    meta: Record<string, unknown>,
    content: string,
  ): void {
    emit("info", mod, "message received", { ...meta, text: content });
  },

  /**
   * Log the AI's full streamed response text.
   */
  aiResponse(
    model: string,
    fullText: string,
    meta: Record<string, unknown>,
  ): void {
    const header = `${ts()}  ${FG.bBlue}◆ RSP${R}  ${fmtMod("ai")} ${D}model${R}${D}=${R}${model}${fmtMeta(meta)}`;
    console.log(header);
    if (fullText) {
      for (const l of fullText.split("\n")) {
        console.log(`${D}  ◆ ${R}${l}`);
      }
    }
  },

  /**
   * Log a streaming text chunk as it arrives from the model.
   */
  streamChunk(text: string): void {
    // Write raw chunk without newline so streaming text appears continuously
    process.stdout.write(`${D}${text}${R}`);
  },

  /**
   * Mark end of a streaming sequence.
   */
  streamEnd(): void {
    // Ensure we're on a new line after streaming chunks
    console.log("");
  },
};

export default log;
