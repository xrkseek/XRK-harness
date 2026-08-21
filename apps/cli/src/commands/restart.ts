/**
 * Stop the previous XRK Host for this port (pid lock / verified process), then serve.
 * Not a synonym of `--force`: never kills foreign listeners.
 */
import { loadHostConfig } from "@xrkseek/server-config";
import type { ParsedArgs } from "../parse-args.js";
import { createCliLogger, resolveLogLevel } from "../log.js";
import { stopOwnHost } from "../port.js";
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
    const { stopped, foreign } = await stopOwnHost(port, log);
    if (stopped.length === 0 && foreign.length === 0) {
      log.info(`restart: no XRK Host on port ${port}`);
    } else if (stopped.length > 0) {
      log.info(`restart: stopped XRK Host pid(s) ${stopped.join(", ")}`);
    }
    if (foreign.length > 0) {
      for (const f of foreign) {
        log.error(
          `restart: port ${port} still held by non-XRK pid ${f.pid} (${f.command})`,
        );
      }
      log.error("pick another --port, or stop that process yourself; refusing to kill it");
      return 1;
    }
  }

  // Soft restart never needs --force (we already stopped our own Host).
  return runServe({ ...args, force: false });
}
