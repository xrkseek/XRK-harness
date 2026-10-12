/**
 * Minimal atomic write helpers for community Cordis host packages.
 * Remapped from `@deepseek-ai/dsh-atomic-write`.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/** Write `data` atomically (temp file + rename). */
export async function writeFileAtomic(
  file: string,
  data: string | Uint8Array,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = join(
    dirname(file),
    `.${randomBytes(8).toString("hex")}.tmp`,
  );
  await writeFile(tmp, data);
  await rename(tmp, file);
}

/**
 * Run `fn` while holding a simple process-local lock for `file`.
 * Not a cross-process flock — enough for single-Host community plugins.
 */
const locks = new Map<string, Promise<unknown>>();

export async function withFileLock<T>(
  file: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const key = file;
  const prior = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = prior.then(() => gate);
  locks.set(
    key,
    chain.catch(() => undefined),
  );
  await prior.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chain) locks.delete(key);
  }
}
