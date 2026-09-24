/**
 * Apply a Codex-format patch through FsService (path-jail + intents).
 */

import { ApplyPatchError, planPatchApplication } from "./apply-patch-apply.js";
import {
  parsePatch,
  PatchParseError,
  type PatchHunk,
} from "./apply-patch-parser.js";

export interface ApplyPatchResult {
  readonly ops: readonly {
    readonly action: "add" | "update" | "delete" | "move";
    readonly path: string;
    readonly fromPath?: string;
  }[];
  readonly hunkCount: number;
}

export interface ApplyPatchFs {
  read(
    userPath: string,
    maxBytes?: number,
  ): Promise<{ readonly content: string; readonly truncated?: boolean }>;
  write(userPath: string, content: string): Promise<void>;
  remove(userPath: string): Promise<void>;
  stat(userPath: string): Promise<{
    readonly size: number;
    readonly isFile: boolean;
    readonly isDirectory: boolean;
  }>;
}

async function tryRead(
  fs: ApplyPatchFs,
  userPath: string,
): Promise<string | undefined> {
  try {
    const st = await fs.stat(userPath);
    if (st.isDirectory) {
      throw new ApplyPatchError(
        `cannot apply patch to directory: ${userPath}`,
      );
    }
    const out = await fs.read(userPath);
    return out.content;
  } catch (err) {
    if (err instanceof ApplyPatchError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (
      /ENOENT|no such file|not found|PathEscape/i.test(message) ||
      (err as NodeJS.ErrnoException)?.code === "ENOENT"
    ) {
      return undefined;
    }
    throw err;
  }
}

/** Parse + apply; emits write intents via FsService. */
export async function applyPatchToFs(
  fs: ApplyPatchFs,
  patchText: string,
): Promise<ApplyPatchResult> {
  let hunks: readonly PatchHunk[];
  try {
    hunks = parsePatch(patchText).hunks;
  } catch (err) {
    if (err instanceof PatchParseError) throw err;
    throw err;
  }

  const cache = new Map<string, string | undefined>();
  const readFile = (p: string): string | undefined => {
    if (!cache.has(p)) {
      throw new ApplyPatchError(`internal: missing cached read for ${p}`);
    }
    return cache.get(p);
  };

  for (const hunk of hunks) {
    if (hunk.kind === "add") {
      cache.set(hunk.path, await tryRead(fs, hunk.path));
    } else if (hunk.kind === "delete") {
      cache.set(hunk.path, await tryRead(fs, hunk.path));
    } else {
      cache.set(hunk.path, await tryRead(fs, hunk.path));
      if (hunk.movePath) {
        cache.set(hunk.movePath, await tryRead(fs, hunk.movePath));
      }
    }
  }

  const plan = planPatchApplication(hunks, readFile);

  for (const [userPath, content] of plan.writes) {
    await fs.write(userPath, content);
  }
  for (const userPath of plan.deletes) {
    if (plan.writes.has(userPath)) continue;
    await fs.remove(userPath);
  }

  return { ops: plan.ops, hunkCount: hunks.length };
}
