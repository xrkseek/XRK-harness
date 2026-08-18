export type CliCommand = "run" | "doctor" | "dump-config" | "serve" | "help";

export interface ParsedArgs {
  readonly command: CliCommand;
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
    first === "help"
  ) {
    command = first;
  } else if (first === "web") {
    command = "serve";
  } else {
    throw new Error(`unknown command: ${first}`);
  }

  let preset = "minimal";
  let promptFromFlag: string | undefined;
  const promptParts: string[] = [];
  let workspace = process.cwd();
  let patchRaw: string | undefined;
  let presentation: "tools" | "code" = "tools";
  let help = false;
  let version = false;
  let open = false;
  let persist = true;
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
    ...(host ? { host } : {}),
    ...(port !== undefined ? { port } : {}),
  };
}

export function helpText(): string {
  return `xrk-harness — XRK Agent Harness CLI

Usage:
  xrk-harness <command> [options] [prompt]

Commands:
  run           One turn (default: minimal + replay; XRK_LLM_PRESET if set)
  serve         HTTP host + product UI (captured DSH Web)
  web           Alias for serve
  doctor        Check node / workspace / product shell
  dump-config   Print layered config JSON
  help          Show this help

Options:
  --preset <id>       Preset id (minimal|harness|server, default: minimal)
  --prompt <text>     User prompt for run (or positional tokens)
  --workspace <path>  User workspace (default: cwd)
  --host <addr>       Bind host (default: 127.0.0.1; not 0.0.0.0)
  --port <n>          Bind port (default: 8787; 0 = OS pick)
  --open              Open the product UI in the system browser
  --no-persist        In-memory sessions (default: {workspace}/.xrk/sessions)
  --patch <json>      Shallow JSON patch merged into dump-config / serve
  --presentation <m>  tools (default) | code (experimental run_code)
  -V, --version       Print CLI version
  -h, --help          Show help

Examples:
  xrk-harness serve --preset server
  xrk-harness web --port 8080 --open
  xrk-harness run --preset minimal "ping"
`;
}
