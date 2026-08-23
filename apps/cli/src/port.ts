/**
 * Port / Host process helpers for serve · restart · --force.
 *
 * Design (deliberately stricter than naive "kill whatever holds the port"):
 * - `restart` / soft stop: SIGTERM the pid in `~/.xrk/run/host-<port>.pid.json`
 *   when that process still looks like an XRK Host.
 * - `--force`: only stop listeners whose command line matches XRK Host fingerprints.
 * - Never silently kill an unknown process on the port (fail with a clear error).
 *
 * OpenClaw/DSH `gateway --force` also frees by port; their mature path is a
 * service-manager restart + optional `--safe` drain. We are a foreground CLI,
 * so the pid-file + own-process filter is the honest equivalent.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CliLogger } from "./log.js";
import { clearHostLock, readHostLock } from "./host-lock.js";

const execFileAsync = promisify(execFile);

/** Command-line fingerprints that identify an XRK product Host. */
const XRK_HOST_FINGERPRINTS: readonly RegExp[] = [
  /xrk-harness/i,
  /\bxrkh\b/i,
  /@xrkseek[/\\]harness-cli/i,
  /harness-cli[/\\](?:dist[/\\])?bin/i,
  /apps[/\\]cli[/\\](?:dist[/\\])?bin/i,
  /[/\\]cli[/\\]dist[/\\]bin\.js/i,
];

export function looksLikeXrkHostCommand(command: string): boolean {
  const c = command.trim();
  if (!c) return false;
  return XRK_HOST_FINGERPRINTS.some((re) => re.test(c));
}

/** PIDs currently LISTENing on `port` (IPv4/IPv6). */
export async function pidsListeningOnPort(port: number): Promise<number[]> {
  if (!Number.isInteger(port) || port <= 0) return [];
  if (process.platform === "win32") return pidsWindows(port);
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

/** Best-effort process command line for `pid` (empty when unknown). */
export async function commandLineForPid(pid: number): Promise<string> {
  if (!Number.isInteger(pid) || pid <= 0) return "";
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
        ],
        { windowsHide: true, maxBuffer: 256 * 1024 },
      );
      return stdout.trim();
    }
    const { stdout } = await execFileAsync(
      "ps",
      ["-p", String(pid), "-o", "args="],
      { maxBuffer: 256 * 1024 },
    );
    return stdout.trim();
  } catch {
    return "";
  }
}

async function stopPid(pid: number, hard: boolean, log?: CliLogger): Promise<void> {
  log?.warn(`stopping pid ${pid}${hard ? " (hard)" : ""}`);
  try {
    if (process.platform === "win32") {
      const args = hard
        ? ["/PID", String(pid), "/T", "/F"]
        : ["/PID", String(pid), "/T"];
      await execFileAsync("taskkill", args, { windowsHide: true });
    } else {
      try {
        process.kill(pid, hard ? "SIGKILL" : "SIGTERM");
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

export async function waitForPortFree(
  port: number,
  timeoutMs = 4_000,
  intervalMs = 150,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const left = (await pidsListeningOnPort(port)).filter((p) => p !== process.pid);
    if (left.length === 0) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return (await pidsListeningOnPort(port)).filter((p) => p !== process.pid).length === 0;
}

export interface StopHostResult {
  readonly stopped: number[];
  readonly foreign: { readonly pid: number; readonly command: string }[];
}

/**
 * Graceful stop of the Host we previously recorded for `port`.
 * Falls back to verified XRK listeners on that port when the lock is stale.
 */
export async function stopOwnHost(
  port: number,
  log?: CliLogger,
): Promise<StopHostResult> {
  const stopped: number[] = [];
  const foreign: { pid: number; command: string }[] = [];
  const lock = readHostLock(port);
  const candidates = new Set<number>();
  if (lock && lock.pid !== process.pid) candidates.add(lock.pid);
  for (const pid of await pidsListeningOnPort(port)) {
    if (pid !== process.pid) candidates.add(pid);
  }

  for (const pid of candidates) {
    const cmd = await commandLineForPid(pid);
    const fromLock = lock?.pid === pid;
    if (fromLock || looksLikeXrkHostCommand(cmd)) {
      await stopPid(pid, false, log);
      stopped.push(pid);
    } else if (cmd || (await pidsListeningOnPort(port)).includes(pid)) {
      // Still listening and not ours — report; do not kill.
      if ((await pidsListeningOnPort(port)).includes(pid)) {
        foreign.push({ pid, command: cmd || "(unknown)" });
      }
    }
  }

  if (stopped.length > 0) {
    await waitForPortFree(port);
    // Escalation only for our own leftover listeners.
    for (const pid of await pidsListeningOnPort(port)) {
      if (pid === process.pid) continue;
      const cmd = await commandLineForPid(pid);
      if (looksLikeXrkHostCommand(cmd) || lock?.pid === pid) {
        await stopPid(pid, true, log);
        if (!stopped.includes(pid)) stopped.push(pid);
      }
    }
    await waitForPortFree(port, 2_000);
  }

  clearHostLock(port);
  return { stopped, foreign };
}

/**
 * `--force`: stop verified XRK Host listeners only.
 * @throws when a non-XRK process still holds the port.
 */
export async function forceFreeXrkPort(
  port: number,
  log?: CliLogger,
): Promise<number[]> {
  const { stopped, foreign } = await stopOwnHost(port, log);
  const still = (await pidsListeningOnPort(port)).filter((p) => p !== process.pid);
  if (still.length === 0) return stopped;

  const blockers: { pid: number; command: string }[] = [...foreign];
  for (const pid of still) {
    if (blockers.some((b) => b.pid === pid)) continue;
    blockers.push({
      pid,
      command: (await commandLineForPid(pid)) || "(unknown)",
    });
  }
  const detail = blockers
    .map((b) => `pid ${b.pid}: ${b.command}`)
    .join("; ");
  throw new Error(
    `port ${port} is held by a non-XRK process — refuse to kill it (${detail}). `
      + `Stop that process yourself, or pick another --port.`,
  );
}

/** @deprecated Prefer {@link forceFreeXrkPort}; kept name for call-site clarity in serve. */
export async function forceFreePort(
  port: number,
  log?: CliLogger,
): Promise<number[]> {
  return forceFreeXrkPort(port, log);
}
