export type CliCommand =
  | "run"
  | "doctor"
  | "dump-config"
  | "serve"
  | "restart"
  | "plugin"
  | "help";

export interface ParsedArgs {
  readonly command: CliCommand;
  /** Remaining argv after `plugin` (subcommand + specs). */
  readonly pluginArgv: readonly string[];
  readonly preset: string;
  readonly prompt: string;
  readonly promptExplicit: boolean;
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
    preset: "minimal",
    prompt: "ping",
    promptExplicit: false,
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
  if (
    first === "run" ||
    first === "doctor" ||
    first === "dump-config" ||
    first === "serve" ||
    first === "restart" ||
    first === "plugin" ||
    first === "help"
  ) {
    command = first;
  } else if (first === "web") {
    command = "serve";
  } else {
    throw new Error(`unknown command: ${first}`);
  }

  // `plugin` owns the rest of argv (subcommand + specs).
  if (command === "plugin") {
    return emptyArgs({ command: "plugin", pluginArgv: args });
  }

  /** Product Host (`web`/`serve`/`restart`) defaults to harness tools; `run` stays minimal for smoke. */
  let preset =
    command === "serve" || command === "restart" ? "harness" : "minimal";
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
    if (!a.startsWith("-")) {
      promptParts.push(a);
      continue;
    }
    throw new Error(`unknown flag: ${a}`);
  }

  const promptExplicit =
    promptFromFlag !== undefined || promptParts.length > 0;
  const prompt =
    promptFromFlag !== undefined
      ? promptFromFlag
      : promptParts.length > 0
        ? promptParts.join(" ")
        : "ping";

  return {
    command: help && command !== "help" ? command : help ? "help" : command,
    pluginArgv: [],
    preset,
    prompt,
    promptExplicit,
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
    ...(host ? { host } : {}),
    ...(port !== undefined ? { port } : {}),
  };
}

export function helpText(): string {
  return `xrkh — XRK Harness CLI (bin also: xrk-harness)

Usage:
  xrkh <command> [options] [prompt]

Commands:
  run           One turn (default: minimal + replay; XRK_LLM_PRESET if set)
  serve         HTTP host + product UI (apps/web/dist)
  web           Alias for serve
  restart       Stop the previous XRK Host on this port (pid lock), then serve
  plugin        Install / remove / list user plugins (~/.xrk/plugins)
  doctor        Check node / workspace / product shell
  dump-config   Print layered config JSON
  help          Show this help

Options:
  --preset <id>       Preset id (minimal|harness|server)
                        · web/serve/restart default: harness (XRK Harness tools)
                        · run default: minimal
                        · server = Host factory name; tools same as harness
  --prompt <text>     User prompt for run (or positional tokens)
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

Examples:
  xrkh web --workspace .
  xrkh restart --port 8787
  xrkh web --force --verbose
  xrkh plugin add ./extensions/example-tools
  xrkh plugin list
  xrkh run --preset minimal "ping"
`;
}
