import { HOST_RUNTIME_PRESET_IDS, isHostRuntimePresetId } from "@xrkseek/server-config";

export type CliCommand =
  | "run"
  | "doctor"
  | "dump-config"
  | "serve"
  | "restart"
  | "plugin"
  | "skill"
  | "mcp"
  | "acp"
  | "help";

export interface ParsedArgs {
  readonly command: CliCommand;
  /** Remaining argv after `plugin` (subcommand + specs). */
  readonly pluginArgv: readonly string[];
  /** Remaining argv after `skill` (subcommand + specs + flags). */
  readonly skillArgv: readonly string[];
  /** Remaining argv after `mcp` (subcommand + server + flags). */
  readonly mcpArgv: readonly string[];
  readonly preset: string;
  readonly prompt: string;
  readonly promptExplicit: boolean;
  /**
   * When true, the task is the lone `-` stdin marker or was omitted on a pipe —
   * `run` reads stdin (verbatim, including trailing newline when piped).
   */
  readonly promptFromStdin: boolean;
  readonly workspace: string;
  readonly patch: Record<string, unknown>;
  readonly presentation: "tools" | "code";
  readonly help: boolean;
  readonly version: boolean;
  readonly open: boolean;
  readonly persist: boolean;
  /** OpenClaw-style: free the listen port before bind. */
  readonly force: boolean;
  readonly verbose: boolean;
  readonly quiet: boolean;
  readonly host?: string;
  readonly port?: number;
  /**
   * Exact session identity to adopt for `run` (opaque; whitespace preserved).
   * Unknown id fails before the turn.
   */
  readonly sessionId?: string;
  /** `run`: newline-delimited session events on stdout instead of final text. */
  readonly json: boolean;
}

function parsePatch(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    throw new Error(`invalid --patch JSON: ${raw}`);
  }
  throw new Error("--patch must be a JSON object");
}

export function assertSafeHost(host: string): void {
  const h = host.trim().toLowerCase();
  if (h === "0.0.0.0" || h === "::" || h === "[::]") {
    throw new Error(
      `--host ${host} is not supported: it would expose the product shell and tool execution to the network; use 127.0.0.1`,
    );
  }
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === "") {
    throw new Error("--port needs a number");
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`--port must be a number, got ${JSON.stringify(raw)}`);
  }
  return Number(raw);
}

function emptyArgs(partial: Partial<ParsedArgs> & { command: CliCommand }): ParsedArgs {
  return {
    pluginArgv: [],
    skillArgv: [],
    mcpArgv: [],
    preset: "minimal",
    prompt: "ping",
    promptExplicit: false,
    promptFromStdin: false,
    workspace: process.cwd(),
    patch: {},
    presentation: "tools",
    help: false,
    version: false,
    open: false,
    persist: true,
    force: false,
    verbose: false,
    quiet: false,
    json: false,
    ...partial,
  };
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const args = [...argv];

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return emptyArgs({ command: "help", help: true });
  }
  if (args[0] === "--version" || args[0] === "-V") {
    return emptyArgs({ command: "help", version: true });
  }

  const first = args.shift()!;
  let command: CliCommand;
  /** `xrkh <preset>` → same as `xrkh web --preset <preset>` (DSH `dsh <name>`). */
  let shorthandPreset: string | undefined;
  if (
    first === "run" ||
    first === "doctor" ||
    first === "dump-config" ||
    first === "serve" ||
    first === "restart" ||
    first === "plugin" ||
    first === "skill" ||
    first === "mcp" ||
    first === "acp" ||
    first === "help"
  ) {
    command = first;
  } else if (first === "web") {
    command = "serve";
  } else if (isHostRuntimePresetId(first)) {
    command = "serve";
    shorthandPreset = first;
  } else {
    throw new Error(
      `unknown command: ${first} (try a command, or a Host preset: ${HOST_RUNTIME_PRESET_IDS.join("|")})`,
    );
  }

  // `plugin` owns the rest of argv (subcommand + specs).
  if (command === "plugin") {
    return emptyArgs({ command: "plugin", pluginArgv: args });
  }

  // `skill` owns the rest of argv too (subcommand + specs + flags), since its
  // `--workspace` / `--dir` / `--force` flags are subcommand-scoped.
  if (command === "skill") {
    return emptyArgs({ command: "skill", skillArgv: args });
  }

  // `mcp` owns the rest of argv too (subcommand + server + flags).
  if (command === "mcp") {
    return emptyArgs({ command: "mcp", mcpArgv: args });
  }

  /** Product Host (`web`/`serve`/`restart`) defaults to harness tools; `run` stays minimal for smoke. */
  let preset =
    shorthandPreset ??
    (command === "serve" || command === "restart" ? "harness" : "minimal");
  let promptFromFlag: string | undefined;
  const promptParts: string[] = [];
  let workspace = process.cwd();
  let patchRaw: string | undefined;
  let presentation: "tools" | "code" = "tools";
  let help = false;
  let version = false;
  let open = false;
  let persist = true;
  let force = false;
  let verbose = false;
  let quiet = false;
  let host: string | undefined;
  let port: number | undefined;
  let sessionId: string | undefined;
  let json = false;

  while (args.length) {
    const a = args.shift()!;
    if (a === "--help" || a === "-h") {
      help = true;
      continue;
    }
    if (a === "--version" || a === "-V") {
      version = true;
      continue;
    }
    if (a === "--open") {
      open = true;
      continue;
    }
    if (a === "--no-persist") {
      persist = false;
      continue;
    }
    if (a === "--force") {
      force = true;
      continue;
    }
    if (a === "--verbose" || a === "-v") {
      verbose = true;
      continue;
    }
    if (a === "--quiet" || a === "-q") {
      quiet = true;
      continue;
    }
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--session-id") {
      sessionId = args.shift();
      if (sessionId === undefined) {
        throw new Error("--session-id needs a value");
      }
      if (sessionId.trim() === "") {
        throw new Error("--session-id requires a non-empty session id");
      }
      continue;
    }
    if (a.startsWith("--session-id=")) {
      sessionId = a.slice("--session-id=".length);
      if (sessionId.trim() === "") {
        throw new Error("--session-id requires a non-empty session id");
      }
      continue;
    }
    if (a === "--preset") {
      preset = args.shift() ?? preset;
      continue;
    }
    if (a.startsWith("--preset=")) {
      preset = a.slice("--preset=".length);
      continue;
    }
    if (a === "--prompt") {
      promptFromFlag = args.shift() ?? "";
      continue;
    }
    if (a.startsWith("--prompt=")) {
      promptFromFlag = a.slice("--prompt=".length);
      continue;
    }
    if (a === "--workspace") {
      workspace = args.shift() ?? workspace;
      continue;
    }
    if (a.startsWith("--workspace=")) {
      workspace = a.slice("--workspace=".length);
      continue;
    }
    if (a === "--patch") {
      patchRaw = args.shift();
      continue;
    }
    if (a.startsWith("--patch=")) {
      patchRaw = a.slice("--patch=".length);
      continue;
    }
    if (a === "--presentation") {
      const v = args.shift() ?? "tools";
      if (v !== "tools" && v !== "code") {
        throw new Error(`invalid --presentation: ${v}`);
      }
      presentation = v;
      continue;
    }
    if (a.startsWith("--presentation=")) {
      const v = a.slice("--presentation=".length);
      if (v !== "tools" && v !== "code") {
        throw new Error(`invalid --presentation: ${v}`);
      }
      presentation = v;
      continue;
    }
    if (a === "--host") {
      host = args.shift();
      if (!host) throw new Error("--host needs a value");
      assertSafeHost(host);
      continue;
    }
    if (a.startsWith("--host=")) {
      host = a.slice("--host=".length);
      assertSafeHost(host);
      continue;
    }
    if (a === "--port") {
      port = parsePort(args.shift());
      continue;
    }
    if (a.startsWith("--port=")) {
      port = parsePort(a.slice("--port=".length));
      continue;
    }
    if (a === "-" || !a.startsWith("-")) {
      promptParts.push(a);
      continue;
    }
    throw new Error(`unknown flag: ${a}`);
  }

  if (promptParts.includes("-") && promptParts.length > 1) {
    throw new Error("`-` must be the only task argument");
  }
  if (promptParts.length > 0 && promptParts.join(" ").trim() === "") {
    throw new Error('a task is required, for example: xrkh run "ping"');
  }

  const stdinMarker =
    promptFromFlag === undefined && promptParts.length === 1 && promptParts[0] === "-";
  const promptExplicit =
    promptFromFlag !== undefined || (promptParts.length > 0 && !stdinMarker);
  const prompt =
    promptFromFlag !== undefined
      ? promptFromFlag
      : stdinMarker
        ? "-"
        : promptParts.length > 0
          ? promptParts.join(" ")
          : "ping";

  return {
    command: help && command !== "help" ? command : help ? "help" : command,
    pluginArgv: [],
    skillArgv: [],
    mcpArgv: [],
    preset,
    prompt,
    promptExplicit,
    promptFromStdin: stdinMarker,
    workspace,
    patch: parsePatch(patchRaw),
    presentation,
    help,
    version,
    open,
    persist,
    force,
    verbose,
    quiet,
    json,
    ...(host ? { host } : {}),
    ...(port !== undefined ? { port } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
  };
}

export function helpText(): string {
  return `xrkh — XRK Harness CLI (bin also: xrk-harness)

Usage:
  xrkh <command> [options] [prompt]
  xrkh <preset> [options]     Same as: xrkh web --preset <preset>

Commands:
  run           One turn (default: minimal + replay; XRK_LLM_PRESET if set)
  serve         HTTP host + product UI (apps/web/dist)
  web           Alias for serve
  restart       Stop the previous XRK Host on this port (pid lock), then serve
  plugin        Install / remove / list user plugins (~/.xrk/plugins)
  skill         Install / remove / list workspace skills (.agents/skills)
  mcp           OAuth device-code login for HTTP MCP servers
  acp           Stdio ACP server (editors spawn this process)
  doctor        Check node / workspace / product shell
  dump-config   Print layered config JSON
  help          Show this help

Host presets (shortcut = web + --preset; ids match XRK_PRESET / Host --preset):
  ${HOST_RUNTIME_PRESET_IDS.join(" | ")}

Options:
  --preset <id>       Session badge seed / run composition
                        (${HOST_RUNTIME_PRESET_IDS.join("|")})
                        · web/serve/restart default: harness
                        · run default: minimal
                        · server = Host factory name; tools same as harness
  --workspace <path>  Workspace root (default: cwd)
  --prompt <text>     User prompt for run (or positional tokens)
  --session-id <id>   Resume a persisted session (unknown id fails)
  --json              NDJSON session events on stdout (run); final text omitted
  --workspace <path>  User workspace (default: cwd)
  --host <addr>       Bind host (default: 127.0.0.1; not 0.0.0.0)
  --port <n>          Bind port (default: 8787; 0 = OS pick)
  --open              Open the product UI in the system browser
  --force             Stop a verified XRK Host on --port before bind
                        (refuses to kill non-XRK listeners)
  --verbose, -v       Debug logs (HTTP /api access + MCP detail)
  --quiet, -q         Warn/error only
  --no-persist        In-memory sessions (default: ~/.xrk/sessions)
  --patch <json>      Shallow JSON patch merged into dump-config / serve
  --presentation <m>  tools (default) | code (experimental run_code)
  -V, --version       Print CLI version
  -h, --help          Show help

Env:
  XRK_LOG / XRK_LOG_LEVEL   silent|error|warn|info|debug (default info)
  XRK_MCP_ALLOW=1           Allow mcp.connect for configured / saved servers
  XRK_PLUGINS_DIR           Plugin root (default: ~/.xrk/plugins when present)
  XRK_SESSIONS_DIR          Persistent sessions dir (default: ~/.xrk/sessions)

Examples:
  xrkh web --workspace .
  xrkh frugal                 Same as: xrkh web --preset frugal
  xrkh shallow --port 8787
  xrkh restart --port 8787
  xrkh web --force --verbose
  xrkh plugin add ./extensions/example-tools
  xrkh plugin list
  xrkh skill add ./skills/office-ping
  xrkh skill add github:acme/skills#pdf-tools
  xrkh skill list
  xrkh mcp login linear --client-id xrk-cli
  xrkh mcp status
  xrkh run --preset minimal "ping"
  echo "summarize" | xrkh run --preset minimal
  xrkh run --json --session-id sess_… "continue"
`;
}
