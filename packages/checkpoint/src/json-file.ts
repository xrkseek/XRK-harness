import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Read JSON, or `undefined` when the file is missing / unparsable. */
export function readJsonFile<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Best-effort atomic JSON write (tmp + rename) so a crash cannot truncate. */
export function writeJsonFileAtomic(file: string, payload: unknown): void {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(tmp, file);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
  }
}
