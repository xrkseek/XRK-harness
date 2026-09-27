import { runDoctor } from "./commands/doctor.js";
import { runDumpConfig } from "./commands/dump-config.js";
import { runMcp } from "./commands/mcp.js";
import { runPlugin } from "./commands/plugin.js";
import { runSkill } from "./commands/skill.js";
import { runAcp } from "./commands/acp.js";
import { runCommand } from "./commands/run.js";
import { runRestart } from "./commands/restart.js";
import { runServe } from "./commands/serve.js";
import { runTui } from "./commands/tui.js";
import { helpText, parseArgs } from "./parse-args.js";
import { jsonFlagRequested, writeJsonError } from "./json-stream.js";
import { readCliVersion } from "./product-paths.js";

export { helpText, parseArgs, readCliVersion };

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
    switch (args.command) {
      case "run":
        return await runCommand(args);
      case "doctor": {
        const result = await runDoctor(args.workspace);
        for (const c of result.checks) {
          process.stdout.write(`${c.ok ? "ok" : "FAIL"}  ${c.name}: ${c.detail}\n`);
        }
        return result.ok ? 0 : 1;
      }
      case "dump-config":
        await runDumpConfig(args);
        return 0;
      case "serve":
        return await runServe(args);
      case "restart":
        return await runRestart(args);
      case "plugin":
        return await runPlugin(args.pluginArgv);
      case "skill":
        return await runSkill(args.skillArgv);
      case "mcp":
        return await runMcp(args.mcpArgv);
      case "acp":
        return await runAcp(args);
      case "tui":
        return await runTui(args);
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
