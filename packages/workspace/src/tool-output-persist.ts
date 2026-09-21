import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  capSpillText,
  pruneSpillTree,
  resolveXrkHome,
} from "@xrkseek/xrk-home-paths";

/** Product data root (`XRK_HOME` / `~/.xrk`). Never the session workspace. */
export function resolveProductHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveXrkHome(env);
}

/** Shared spill tree: `{productHome}/spill` (Host `hostReadableRoots`). */
export function resolveSpillRoot(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveProductHome(env), "spill");
}

export interface WorkspaceToolOutputPersistOptions {
  /**
   * Persist root. Default: {@link resolveProductHome} (system data, not the
   * session workspace). Callers must not pass `workspaceRoot`.
   */
  readonly root?: string;
  /**
   * Directory under root. Default `spill/tool-outputs` so Host
   * `hostReadableRoots` (`~/.xrk/spill`) can `read_file` the marker path.
   */
  readonly relativeDir?: string;
}

export interface WorkspaceToolOutputPersist {
  /** Absolute directory where files are written. */
  readonly dir: string;
  /**
   * Persist full tool content. Returns an **absolute** path for truncation
   * markers (`read_file` via hostReadableRoots).
   */
  persist(fullContent: string): Promise<string>;
}

/**
 * Host-side persist for `boundToolOutput` / pipeline `outputBound.persist`.
 * Writes under product home; the model/session see the bound view only.
 */
export function createWorkspaceToolOutputPersist(
  options: WorkspaceToolOutputPersistOptions = {},
): WorkspaceToolOutputPersist {
  const root = path.resolve(options.root ?? resolveProductHome());
  const relativeDir = (options.relativeDir ?? "spill/tool-outputs").replace(
    /\\/g,
    "/",
  );
  const dir = path.resolve(root, relativeDir);

  const relCheck = path.relative(root, dir);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    throw new Error(
      `tool-output persist dir must stay under product home: ${relativeDir}`,
    );
  }

  let ready: Promise<void> | undefined;
  const ensureDir = () => {
    ready ??= mkdir(dir, { recursive: true }).then(() => undefined);
    return ready;
  };

  return {
    dir,
    async persist(fullContent: string): Promise<string> {
      const spill = path.resolve(root, "spill");
      const rel = path.relative(spill, dir);
      const tree =
        rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
          ? spill
          : dir;
      pruneSpillTree(tree);
      await ensureDir();
      const name = `tool_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}.txt`;
      const abs = path.join(dir, name);
      await writeFile(abs, capSpillText(fullContent), "utf8");
      return abs;
    },
  };
}
