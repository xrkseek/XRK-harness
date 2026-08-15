import { createHarnessComposition } from "@xrkseek/preset-harness";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { dumpServeConfig } from "./serve.js";
import type { ParsedArgs } from "../parse-args.js";

export async function runDumpConfig(args: ParsedArgs): Promise<void> {
  if (args.preset === "server") {
    process.stdout.write(
      `${JSON.stringify(dumpServeConfig(args), null, 2)}\n`,
    );
    return;
  }
  if (args.preset === "harness") {
    const composition = createHarnessComposition({
      workspaceRoot: args.workspace,
    });
    process.stdout.write(
      `${JSON.stringify(composition.dumpConfig(args.patch), null, 2)}\n`,
    );
    return;
  }
  if (args.preset !== "minimal") {
    throw new Error(`unsupported preset: ${args.preset}`);
  }
  const composition = createMinimalComposition({
    workspaceRoot: args.workspace,
  });
  const config = composition.dumpConfig(args.patch);
  process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
}
