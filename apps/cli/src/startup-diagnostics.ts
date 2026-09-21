/** Write full startup diagnostics while keeping the terminal report concise. */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspect } from "node:util";
import {
  StartupError,
  startupErrorFromUnknown,
} from "@xrkseek/server-loader";
import { resolveXrkHome } from "@xrkseek/server-config";
import { readCliVersion } from "./product-paths.js";

export interface StartupDiagnosticContext {
  readonly home: string;
  readonly version: string;
  readonly profile: string;
}

/** Wait for stderr to finish the write before the failed process exits. */
function writeStderr(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stderr.write(text, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * Normalize any thrown value into {@link StartupError} (classify failed vs pending).
 * {@link RequiredPluginLoadError} is already a StartupError subclass.
 */
export function asStartupError(err: unknown): StartupError {
  if (err instanceof StartupError) return err;
  return startupErrorFromUnknown(err, "xrkh");
}

/**
 * Print the startup summary and save a private, uniquely named report under
 * `{XRK_HOME}/logs` (DSH `$DSH_HOME/logs/startup-*.log`).
 * Failed writes print the complete report to stderr instead of claiming a path.
 */
export async function reportStartupFailure(
  error: StartupError,
  context: StartupDiagnosticContext,
  write: (text: string) => void | Promise<void> = writeStderr,
): Promise<void> {
  const now = new Date().toISOString();
  const report =
    "WARNING: Raw diagnostics may contain configuration or credential values from plugin errors. Review before sharing.\n\n" +
    inspect(
      {
        timestamp: now,
        xrkVersion: context.version,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        profile: context.profile,
        error,
      },
      {
        depth: null,
        maxArrayLength: null,
        maxStringLength: null,
        showHidden: true,
        customInspect: false,
        getters: false,
        colors: false,
      },
    ) +
    "\n";
  await write(`${error.message}\n`);
  const logDir = join(context.home, "logs");
  const logPath = join(
    logDir,
    `startup-${now.replaceAll(":", "-")}-${randomUUID()}.log`,
  );
  try {
    await mkdir(logDir, { recursive: true, mode: 0o700 });
    await writeFile(logPath, report, { flag: "wx", mode: 0o600 });
  } catch (writeError) {
    await write(
      `\nxrkh: warning: could not write startup diagnostics: ${String(writeError)}\nFull diagnostics:\n${report}`,
    );
    return;
  }
  await write(`\nFull diagnostics: ${logPath}\n`);
}

/** Convenience: resolve home/version and report. */
export async function reportCliStartupFailure(
  err: unknown,
  profile: string,
  write?: (text: string) => void | Promise<void>,
): Promise<void> {
  const error = asStartupError(err);
  await reportStartupFailure(
    error,
    {
      home: resolveXrkHome(),
      version: readCliVersion(),
      profile,
    },
    write,
  );
}
