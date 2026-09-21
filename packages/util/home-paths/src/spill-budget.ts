/**
 * Disk budget for `{XRK_HOME}/spill`.
 * One file cap, one tree cap, and an age sweep. Best-effort: never throws.
 */
import { lstatSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import path from "node:path";

/** Largest single spill file (UTF-8 bytes), including the cap notice. */
export const SPILL_MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Largest `{home}/spill` tree. Older files are removed first. */
export const SPILL_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

/** Files older than this are removed on the next spill write. */
export const SPILL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PruneSpillTreeOptions {
  readonly now?: number;
  readonly maxTotalBytes?: number;
  readonly maxAgeMs?: number;
}

/** Prefix of `text` with at most `maxBytes` UTF-8 bytes (no mid-sequence cut). */
function utf8Prefix(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString("utf8");
}

/**
 * Keep a spill body within {@link SPILL_MAX_FILE_BYTES}.
 * Over-cap text is cut and marked; under-cap text is unchanged.
 */
export function capSpillText(
  text: string,
  maxBytes: number = SPILL_MAX_FILE_BYTES,
): string {
  const max = Math.max(0, Math.floor(maxBytes));
  if (max === 0) return "";
  if (Buffer.byteLength(text, "utf8") <= max) return text;
  const note = `\n\n[spill file capped at ${max} bytes]\n`;
  const noteBytes = Buffer.byteLength(note, "utf8");
  if (noteBytes >= max) return utf8Prefix(note, max);
  return utf8Prefix(text, max - noteBytes) + note;
}

interface SpillFile {
  readonly file: string;
  readonly mtimeMs: number;
  readonly size: number;
}

function listRegularFiles(dir: string, out: SpillFile[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listRegularFiles(abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const st = lstatSync(abs);
      if (!st.isFile() || st.isSymbolicLink()) continue;
      out.push({ file: abs, mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      // Raced away. Skip.
    }
  }
}

function removeEmptyDirs(dir: string, root: string): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    removeEmptyDirs(path.join(dir, entry.name), root);
  }
  if (path.resolve(dir) === path.resolve(root)) return;
  try {
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    // Not empty, or already gone.
  }
}

/**
 * Delete aged spill files, then oldest files until the tree is under the
 * total cap. Skips symlinks. Does not remove `root` itself.
 */
export function pruneSpillTree(
  root: string,
  options: PruneSpillTreeOptions = {},
): void {
  try {
    const now = options.now ?? Date.now();
    const maxAgeMs = options.maxAgeMs ?? SPILL_MAX_AGE_MS;
    const maxTotal = options.maxTotalBytes ?? SPILL_MAX_TOTAL_BYTES;
    const resolved = path.resolve(root);
    const files: SpillFile[] = [];
    listRegularFiles(resolved, files);
    const cutoff = now - maxAgeMs;
    const kept: SpillFile[] = [];
    for (const file of files) {
      if (file.mtimeMs < cutoff) {
        try {
          unlinkSync(file.file);
        } catch {
          kept.push(file);
        }
      } else {
        kept.push(file);
      }
    }
    kept.sort((a, b) => a.mtimeMs - b.mtimeMs || a.file.localeCompare(b.file));
    let total = kept.reduce((sum, file) => sum + file.size, 0);
    for (const file of kept) {
      if (total <= maxTotal) break;
      try {
        unlinkSync(file.file);
        total -= file.size;
      } catch {
        // Leave it; the next write retries.
      }
    }
    removeEmptyDirs(resolved, resolved);
  } catch {
    // Budget enforcement must not fail the spill write.
  }
}
