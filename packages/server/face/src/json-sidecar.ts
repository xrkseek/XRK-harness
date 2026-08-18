/**
 * Best-effort JSON sidecar (goals / subagents). Persist must not fail Face RPC.
 * Write tmp then rename so a crash cannot leave a truncated JSON file.
 */

import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export function writeJsonSidecar(file: string, payload: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  try {
    renameSync(tmp, file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "EPERM") {
      unlinkSync(file);
      renameSync(tmp, file);
      return;
    }
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export function tryWriteJsonSidecar(file: string, payload: unknown): void {
  try {
    writeJsonSidecar(file, payload);
  } catch {
    /* sidecar is not session truth */
  }
}
