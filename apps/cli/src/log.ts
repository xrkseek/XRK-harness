/**
 * CLI / Host console log (DSH: URL + lifecycle belong to the shell; OpenClaw: --verbose).
 */

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const RANK: Record<LogLevel, number> = {
  silent: 100,
  error: 40,
  warn: 30,
  info: 20,
  debug: 10,
};

export interface CliLogger {
  readonly level: LogLevel;
  error(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
  debug(msg: string): void;
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

export function createCliLogger(level: LogLevel): CliLogger {
  const write = (min: LogLevel, stream: NodeJS.WriteStream, msg: string) => {
    if (RANK[level] > RANK[min]) return;
    stream.write(`${stamp()} ${msg}\n`);
  };
  return {
    level,
    error: (msg) => write("error", process.stderr, `error  ${msg}`),
    warn: (msg) => write("warn", process.stderr, `warn   ${msg}`),
    info: (msg) => write("info", process.stdout, msg),
    debug: (msg) => write("debug", process.stderr, `debug  ${msg}`),
  };
}
