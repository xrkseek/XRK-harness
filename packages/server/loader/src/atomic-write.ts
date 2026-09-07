/**
 * Atomic text replace for managed plugin state files.
 * Readers never observe a torn write (temp + rename).
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export function atomicWriteText(file: string, body: string): void {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, file);
}
