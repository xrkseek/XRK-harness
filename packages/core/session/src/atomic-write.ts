/**
 * Crash-safe replace: write a sibling tmp file, then rename over the destination.
 * Windows may need unlink+rename when the target already exists.
 */
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export function writeTextFileAtomicSync(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, text, "utf8");
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
