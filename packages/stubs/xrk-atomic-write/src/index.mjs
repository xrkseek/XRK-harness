/**
 * Minimal atomic write helpers for community Cordis host packages.
 * Remapped from `@deepseek-ai/dsh-atomic-write`.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/** Write `data` atomically (temp file + rename). */
export async function writeFileAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${randomBytes(8).toString("hex")}.tmp`);
  await writeFile(tmp, data);
  await rename(tmp, file);
}

const locks = new Map();

/** Process-local lock — enough for single-Host community plugins. */
export async function withFileLock(file, fn) {
  const prior = locks.get(file) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const chain = prior.then(() => gate);
  locks.set(
    file,
    chain.catch(() => undefined),
  );
  await prior.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(file) === chain) locks.delete(file);
  }
}
