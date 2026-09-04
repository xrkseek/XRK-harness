import { createHarnessComposition } from "@xrkseek/preset-harness";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { resolveAgentPresetProfile } from "@xrkseek/server-face";
import { dumpServeConfig } from "./serve.js";
import type { ParsedArgs } from "../parse-args.js";

export async function runDumpConfig(args: ParsedArgs): Promise<void> {
  if (args.preset === "server") {
    process.stdout.write(
      `${JSON.stringify(dumpServeConfig(args), null, 2)}\n`,
    );
    return;
  }
  const profile = resolveAgentPresetProfile(args.preset, "minimal");
  if (profile.composition === "harness") {
    const composition = createHarnessComposition({
      workspaceRoot: args.workspace,
      subagentRouting: profile.subagentRouting,
      webTools: profile.tools.web,
      lspTools: profile.tools.lsp,
      ...(profile.tools.pty ? {} : { ptyTools: false }),
    });
    process.stdout.write(
      `${JSON.stringify(composition.dumpConfig(args.patch), null, 2)}\n`,
    );
    return;
  }
  const composition = createMinimalComposition({
    workspaceRoot: args.workspace,
  });
  const config = composition.dumpConfig(args.patch);
  process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
}
