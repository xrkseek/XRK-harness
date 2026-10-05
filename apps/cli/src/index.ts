import { helpText, parseArgs } from "./parse-args.js";
import { jsonFlagRequested, writeJsonError } from "./json-stream.js";
import { readCliVersion } from "./product-paths.js";

export { helpText, parseArgs, readCliVersion };
export {
  ensureUserHomeSeeds,
  ensureUserStandingSeeds,
  ensureUserSkillSeeds,
  ensureUserRecipeSeeds,
  establishProductHomeSeeds,
  formatHomeSeedLogLines,
  formatHomeSeedDoctorDetail,
  bundledStandingSeedsRoot,
  bundledSkillSeedsRoot,
  bundledRecipeSeedsRoot,
  type EnsureUserHomeSeedsResult,
  type EnsureUserSkillSeedsResult,
  type FlatSeedPolicy,
} from "./user-skill-seeds.js";


/**
 * Commands that host an agent runtime → the surface the model should assume.
 * `tui` is absent on purpose: it attaches to an existing Host, so the surface
 * stays whatever the Host declared.
 */
const COMMAND_SURFACE: Partial<Record<string, string>> = {
  serve: "web",
  run: "cli",
  acp: "acp",
};

/**
 * Declare `XRK_SURFACE` for Host-hosting commands (feeds the model's
 * `## Runtime surface` inject). Never overrides an inherited value — the
 * Desktop Host declares `desktop` before any CLI command could run.
 * @param command - parsed CLI command.
 */
export function declareRuntimeSurface(command: string): void {
  const surface = COMMAND_SURFACE[command];
  if (surface === undefined) return;
  if (process.env.XRK_SURFACE === undefined) process.env.XRK_SURFACE = surface;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonFlagRequested(argv)) {
      writeJsonError(process.stdout, message);
    } else {
      console.error(`error: ${message}`);
      console.error(helpText());
    }
    return 1;
  }

  if (args.version && !args.help) {
    process.stdout.write(`${readCliVersion()}\n`);
    return 0;
  }

  if (args.command === "help" || args.help) {
    process.stdout.write(helpText());
    return 0;
  }

  declareRuntimeSurface(args.command);

  try {
    // Command modules are loaded lazily: bare `--version` / `--help` /
    // parse errors are answered before any command module (and its
    // `@xrkseek/server-*` dependency tree) is compiled. Commands that do
    // host an agent runtime (`serve`, `run`, `acp`) still pay the full tree,
    // but only when actually invoked.
    switch (args.command) {
      case "run": {
        const { runCommand } = await import("./commands/run.js");
        return await runCommand(args);
      }
      case "doctor": {
        const { runDoctor } = await import("./commands/doctor.js");
        const result = await runDoctor(args.workspace);
        for (const c of result.checks) {
          process.stdout.write(`${c.ok ? "ok" : "FAIL"}  ${c.name}: ${c.detail}\n`);
        }
        return result.ok ? 0 : 1;
      }
      case "dump-config": {
        const { runDumpConfig } = await import("./commands/dump-config.js");
        await runDumpConfig(args);
        return 0;
      }
      case "serve": {
        const { runServe } = await import("./commands/serve.js");
        return await runServe(args);
      }
      case "restart": {
        const { runRestart } = await import("./commands/restart.js");
        return await runRestart(args);
      }
      case "plugin": {
        const { runPlugin } = await import("./commands/plugin.js");
        return await runPlugin(args.pluginArgv);
      }
      case "skill": {
        const { runSkill } = await import("./commands/skill.js");
        return await runSkill(args.skillArgv);
      }
      case "mcp": {
        const { runMcp } = await import("./commands/mcp.js");
        return await runMcp(args.mcpArgv);
      }
      case "acp": {
        const { runAcp } = await import("./commands/acp.js");
        return await runAcp(args);
      }
      case "tui": {
        const { runTui } = await import("./commands/tui.js");
        return await runTui(args);
      }
      default:
        process.stdout.write(helpText());
        return 0;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (args.json) {
      writeJsonError(process.stdout, message);
    } else {
      console.error(`error: ${message}`);
    }
    return 1;
  }
}
