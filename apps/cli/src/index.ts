import { runDoctor } from "./commands/doctor.js";
import { runDumpConfig } from "./commands/dump-config.js";
import { runPlugin } from "./commands/plugin.js";
import { runCommand } from "./commands/run.js";
import { runRestart } from "./commands/restart.js";
import { runServe } from "./commands/serve.js";
import { helpText, parseArgs } from "./parse-args.js";
import { readCliVersion } from "./product-paths.js";

export { helpText, parseArgs, readCliVersion };

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`error: ${message}`);
    console.error(helpText());
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

  try {
    switch (args.command) {
      case "run":
        return await runCommand(args);
      case "doctor": {
        const result = await runDoctor(args.workspace, {
          seedSkills: args.seedSkills,
        });
        for (const c of result.checks) {
          process.stdout.write(
            `${c.ok ? "ok" : "FAIL"}  ${c.name}: ${c.detail}\n`,
          );
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
      default:
        process.stdout.write(helpText());
        return 0;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`error: ${message}`);
    return 1;
  }
}
