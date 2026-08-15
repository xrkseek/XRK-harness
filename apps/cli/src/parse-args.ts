export type CliCommand = "run" | "doctor" | "dump-config" | "serve" | "help";

export interface ParsedArgs {
  readonly command: CliCommand;
  readonly preset: string;
  readonly prompt: string;
  readonly workspace: string;
  readonly patch: Record<string, unknown>;
  readonly presentation: "tools" | "code";
  readonly help: boolean;
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

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const args = [...argv];
  let command: CliCommand;
  let preset = "minimal";
  let prompt = "ping";
  let workspace = process.cwd();
  let patchRaw: string | undefined;
  let presentation: "tools" | "code" = "tools";
  let help = false;

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return {
      command: "help",
      preset,
      prompt,
      workspace,
      patch: {},
      presentation,
      help: true,
    };
  }

  const first = args.shift()!;
  if (
    first === "run" ||
    first === "doctor" ||
    first === "dump-config" ||
    first === "serve" ||
    first === "help"
  ) {
    command = first;
  } else {
    throw new Error(`unknown command: ${first}`);
  }

  while (args.length) {
    const a = args.shift()!;
    if (a === "--help" || a === "-h") {
      help = true;
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
      prompt = args.shift() ?? prompt;
      continue;
    }
    if (a.startsWith("--prompt=")) {
      prompt = a.slice("--prompt=".length);
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
    throw new Error(`unknown flag: ${a}`);
  }

  return {
    command: help && command !== "help" ? command : help ? "help" : command,
    preset,
    prompt,
    workspace,
    patch: parsePatch(patchRaw),
    presentation,
    help,
  };
}

export function helpText(): string {
  return `xrk-harness — XRK Agent Harness CLI

Usage:
  xrk-harness <command> [options]

Commands:
  run           Run one turn with a preset (default: minimal + replay LLM)
  doctor        Check node / pnpm / workspace path
  dump-config   Print layered config JSON
  serve         Start HTTP host (REST + SSE chat)
  help          Show this help

Options:
  --preset <id>       Preset id (minimal|harness|server, default: minimal)
  --prompt <text>     User prompt for run (default: ping)
  --workspace <path>  Workspace root (default: cwd)
  --patch <json>      Shallow JSON patch merged into dump-config / serve
  --presentation <m>  tools (default) | code (experimental run_code)
  -h, --help          Show help
`;
}
