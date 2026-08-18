/**
 * Best-effort JSON sidecar (goals / subagents). Persist must not fail Face RPC.
 * Delegates to session atomic replace so a crash cannot leave truncated JSON.
 */

import { writeTextFileAtomicSync } from "@xrkseek/core-session";

export function writeJsonSidecar(file: string, payload: unknown): void {
  writeTextFileAtomicSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

export function tryWriteJsonSidecar(file: string, payload: unknown): void {
  try {
    writeJsonSidecar(file, payload);
  } catch {
    /* sidecar is not session truth */
  }
}
