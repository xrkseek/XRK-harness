import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface WorkspaceToolOutputPersistOptions {
  /** Workspace root (absolute or relative). */
  readonly root: string;
  /**
   * Directory under root for full outputs.
   * Default: `.xrk/tool-outputs` (product isolation; not repo AGENTS.md).
   */
  readonly relativeDir?: string;
}

export interface WorkspaceToolOutputPersist {
  /** Absolute directory where files are written. */
  readonly dir: string;
  /**
   * Persist full tool content. Returns a **workspace-relative** POSIX path
   * suitable for model-facing truncation markers.
   */
  persist(fullContent: string): Promise<string>;
}

/**
 * Host-side persist for `boundToolOutput` / pipeline `outputBound.persist`.
 * Keeps full text on disk under the product dir; model/session see the bound view.
 */
export function createWorkspaceToolOutputPersist(
  options: WorkspaceToolOutputPersistOptions,
): WorkspaceToolOutputPersist {
  const root = path.resolve(options.root);
  const relativeDir = (options.relativeDir ?? ".xrk/tool-outputs").replace(
    /\\/g,
    "/",
  );
  const dir = path.resolve(root, relativeDir);

  // Refuse paths that escape root (misconfigured relativeDir).
  const relCheck = path.relative(root, dir);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    throw new Error(
      `tool-output persist dir must stay under workspace root: ${relativeDir}`,
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
      await ensureDir();
      const name = `tool_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}.txt`;
      const abs = path.join(dir, name);
      await writeFile(abs, fullContent, "utf8");
      return `${relativeDir}/${name}`.replace(/\\/g, "/");
    },
  };
}
