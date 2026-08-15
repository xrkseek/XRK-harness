import { runDoctor } from "./commands/doctor.js";
import { runDumpConfig } from "./commands/dump-config.js";
import { runCommand } from "./commands/run.js";
import { runServe } from "./commands/serve.js";
import { helpText, parseArgs } from "./parse-args.js";

export { helpText, parseArgs };

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

  if (args.command === "help" || args.help) {
    process.stdout.write(helpText());
    return 0;
  }

  try {
    switch (args.command) {
      case "run":
        return await runCommand(args);
      case "doctor": {
        const result = await runDoctor(args.workspace);
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
