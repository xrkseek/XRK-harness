/**
 * Host process lock under `~/.xrk/run/` — so `restart` can stop *our* Host
 * without killing whatever else happens to bind the same TCP port.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveXrkHome } from "@xrkseek/server-config";

export interface HostLockRecord {
  readonly pid: number;
  readonly port: number;
  readonly startedAt: number;
  /** Short argv fingerprint for humans / verification. */
  readonly argv: string;
}

export function hostRunDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveXrkHome(env), "run");
}

export function hostLockPath(
  port: number,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(hostRunDir(env), `host-${port}.pid.json`);
}

export function writeHostLock(
  port: number,
  env: NodeJS.ProcessEnv = process.env,
): HostLockRecord {
  const dir = hostRunDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const record: HostLockRecord = {
    pid: process.pid,
    port,
    startedAt: Date.now(),
    argv: process.argv.slice(0, 3).join(" "),
  };
  fs.writeFileSync(hostLockPath(port, env), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

export function readHostLock(
  port: number,
  env: NodeJS.ProcessEnv = process.env,
): HostLockRecord | null {
  const file = hostLockPath(port, env);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<HostLockRecord>;
    if (
      typeof raw.pid !== "number" ||
      !Number.isInteger(raw.pid) ||
      raw.pid <= 0 ||
      typeof raw.port !== "number"
    ) {
      return null;
    }
    return {
      pid: raw.pid,
      port: raw.port,
      startedAt: typeof raw.startedAt === "number" ? raw.startedAt : 0,
      argv: typeof raw.argv === "string" ? raw.argv : "",
    };
  } catch {
    return null;
  }
}

export function clearHostLock(
  port: number,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const file = hostLockPath(port, env);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* best-effort */
  }
}

export function listHostLocks(
  env: NodeJS.ProcessEnv = process.env,
): HostLockRecord[] {
  const dir = hostRunDir(env);
  if (!fs.existsSync(dir)) return [];
  const records: HostLockRecord[] = [];
  for (const name of fs.readdirSync(dir)) {
    const match = /^host-(\d+)\.pid\.json$/.exec(name);
    if (!match) continue;
    const rec = readHostLock(Number(match[1]), env);
    if (rec) records.push(rec);
  }
  return records;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Newest lock whose process is still running. */
export function newestLiveHostLock(
  env: NodeJS.ProcessEnv = process.env,
): HostLockRecord | null {
  let best: HostLockRecord | null = null;
  for (const rec of listHostLocks(env)) {
    if (!pidAlive(rec.pid)) continue;
    if (best === null || rec.startedAt >= best.startedAt) best = rec;
  }
  return best;
}

/** True when this process still owns the lock file for `port`. */
export function ownsHostLock(
  port: number,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const lock = readHostLock(port, env);
  return lock !== null && lock.pid === process.pid;
}
