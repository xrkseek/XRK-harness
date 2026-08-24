/**
 * CLI / Host console log.
 *
 * Levels: flag (--verbose / --quiet) > XRK_LOG / XRK_LOG_LEVEL > default info.
 * Lines are `HH:mm:ss.sss <level> <message>` on stdout (info) or stderr (rest).
 */

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const RANK: Record<LogLevel, number> = {
  silent: 100,
  error: 40,
  warn: 30,
  info: 20,
  debug: 10,
};

const LEVEL_TAG: Record<Exclude<LogLevel, "silent">, string> = {
  error: "error",
  warn: "warn ",
  info: "info ",
  debug: "debug",
};

export interface CliLogger {
  readonly level: LogLevel;
  error(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
  debug(msg: string): void;
  /** Nested scope: `plugin add foo` → `info  plugin  add foo`. */
  child(scope: string): CliLogger;
}

function parseLevel(raw: string | undefined): LogLevel | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (
    v === "silent" ||
    v === "error" ||
    v === "warn" ||
    v === "info" ||
    v === "debug"
  ) {
    return v;
  }
  return undefined;
}

/** Resolve level: flag > XRK_LOG / XRK_LOG_LEVEL > default info. */
export function resolveLogLevel(options: {
  readonly verbose?: boolean;
  readonly quiet?: boolean;
  readonly env?: NodeJS.ProcessEnv;
}): LogLevel {
  if (options.quiet) return "warn";
  if (options.verbose) return "debug";
  const env = options.env ?? process.env;
  return (
    parseLevel(env.XRK_LOG) ??
    parseLevel(env.XRK_LOG_LEVEL) ??
    "info"
  );
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23); // HH:mm:ss.sss
}

function createScopedLogger(level: LogLevel, scope: string): CliLogger {
  const prefix = scope ? `${scope}  ` : "";
  const write = (
    min: Exclude<LogLevel, "silent">,
    stream: NodeJS.WriteStream,
    msg: string,
  ) => {
    if (RANK[level] > RANK[min]) return;
    stream.write(`${stamp()} ${LEVEL_TAG[min]}  ${prefix}${msg}\n`);
  };
  return {
    level,
    error: (msg) => write("error", process.stderr, msg),
    warn: (msg) => write("warn", process.stderr, msg),
    info: (msg) => write("info", process.stdout, msg),
    debug: (msg) => write("debug", process.stderr, msg),
    child: (next) =>
      createScopedLogger(level, scope ? `${scope}.${next}` : next),
  };
}

export function createCliLogger(level: LogLevel): CliLogger {
  return createScopedLogger(level, "");
}
