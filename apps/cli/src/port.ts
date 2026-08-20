/**
 * Free a TCP listen port before serve (OpenClaw `gateway --force` UX).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CliLogger } from "./log.js";

const execFileAsync = promisify(execFile);

/** PIDs currently LISTENing on `port` (IPv4/IPv6). */
export async function pidsListeningOnPort(port: number): Promise<number[]> {
  if (!Number.isInteger(port) || port <= 0) return [];
  if (process.platform === "win32") {
    return pidsWindows(port);
  }
  return pidsUnix(port);
}

async function pidsWindows(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync(
      "netstat",
      ["-ano", "-p", "TCP"],
      { windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
    );
    const needle = `:${port}`;
    const pids = new Set<number>();
    for (const line of stdout.split(/\r?\n/)) {
      if (!/\bLISTENING\b/i.test(line)) continue;
      if (!line.includes(needle)) continue;
      // Local address column may be 0.0.0.0:8787 or [::]:8787 or 127.0.0.1:8787
      const parts = line.trim().split(/\s+/);
      const local = parts[1] ?? "";
      if (!local.endsWith(needle) && !local.includes(`]:${port}`)) continue;
      const pid = Number(parts[parts.length - 1]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

async function pidsUnix(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync(
      "lsof",
      [`-iTCP:${port}`, "-sTCP:LISTEN", "-n", "-P", "-t"],
      { maxBuffer: 512 * 1024 },
    );
    return [
      ...new Set(
        stdout
          .split(/\r?\n/)
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
  } catch {
    return [];
  }
}

/**
 * SIGTERM/SIGKILL (or taskkill) every listener on `port`.
 * Skips the current process.
 */
export async function forceFreePort(
  port: number,
  log?: CliLogger,
): Promise<number[]> {
  const pids = (await pidsListeningOnPort(port)).filter(
    (pid) => pid !== process.pid,
  );
  if (pids.length === 0) return [];
  for (const pid of pids) {
    log?.warn(`freeing port ${port}: stop pid ${pid}`);
    try {
      if (process.platform === "win32") {
        await execFileAsync(
          "taskkill",
          ["/PID", String(pid), "/T", "/F"],
          { windowsHide: true },
        );
      } else {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          /* already gone */
        }
      }
    } catch (err) {
      log?.warn(
        `could not stop pid ${pid}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  // Brief settle so the OS releases the bind.
  await new Promise((r) => setTimeout(r, 400));
  return pids;
}
