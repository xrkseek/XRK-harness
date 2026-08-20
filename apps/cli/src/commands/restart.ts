/**
 * Free the listen port, then start serve (OpenClaw `gateway restart` UX for foreground Host).
 */
import { loadHostConfig } from "@xrkseek/server-config";
import type { ParsedArgs } from "../parse-args.js";
import { createCliLogger, resolveLogLevel } from "../log.js";
import { forceFreePort } from "../port.js";
import { runServe } from "./serve.js";

export async function runRestart(args: ParsedArgs): Promise<number> {
  const log = createCliLogger(
    resolveLogLevel({ verbose: args.verbose, quiet: args.quiet }),
  );
  const patch: Record<string, unknown> = {
    ...args.patch,
    workspaceRoot: args.workspace,
    preset: args.preset,
  };
  if (args.host) patch.host = args.host;
  if (args.port !== undefined) patch.port = args.port;
  const config = loadHostConfig({ patch });
  const port = config.runtime.port;
  if (port > 0) {
    const killed = await forceFreePort(port, log);
    if (killed.length === 0) {
      log.info(`restart: nothing listening on ${port}`);
    } else {
      log.info(`restart: freed port ${port}`);
    }
  }
  return runServe({ ...args, force: false });
}
