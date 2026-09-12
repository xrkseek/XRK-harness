import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const HOME_ENVS = ["XRK_HOME", "XRK_DSH_HOME", "DSH_HOME"] as const;

function expandHomePath(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

/**
 * Product data root (`XRK_HOME` / `~/.xrk`). Never the session workspace.
 * Mirrors `@xrkseek/server-config` `resolveXrkHome` without taking that dep
 * (workspace is a leaf under presets).
 */
export function resolveProductHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  for (const key of HOME_ENVS) {
    const raw = env[key]?.trim();
    if (raw) return path.resolve(expandHomePath(raw));
  }
  return path.resolve(path.join(homedir(), ".xrk"));
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
      await ensureDir();
      const name = `tool_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}.txt`;
      const abs = path.join(dir, name);
      await writeFile(abs, fullContent, "utf8");
      return abs;
    },
  };
}
