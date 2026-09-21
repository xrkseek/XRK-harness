/**
 * User-data home for XRK-Harness (DSH `~/.dsh` posture).
 *
 * Canonical resolution lives in `@xrkseek/xrk-home-paths`; this module
 * re-exports it and adds Host-facing path helpers.
 */
import { expandHomePath, resolveXrkHome } from "@xrkseek/xrk-home-paths";
import path from "node:path";

export {
  DEFAULT_XRK_HOME_DISPLAY,
  XRK_HOME_DIR_NAME,
  XRK_HOME_ENVS,
  defaultXrkHome,
  expandHomePath,
  resolveConfiguredXrkHome,
  resolveXrkHome,
  xrkHomeDisplay,
  xrkHomePath,
} from "@xrkseek/xrk-home-paths";

/** `{home}/sessions` — CLI persist default when `XRK_SESSIONS_DIR` is unset. */
export function defaultSessionsDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveXrkHome(env), "sessions");
}

/** `{home}/host-settings.json` — Face MCP desired-servers dump. */
export function hostSettingsPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveXrkHome(env), "host-settings.json");
}

/**
 * `{home}/plugins` — CLI `plugin add` root + optional Host `pluginsDir`.
 * Process discover + `{plugins}/web/` client overlay live here.
 */
export function defaultPluginsDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveXrkHome(env), "plugins");
}

/**
 * `{home}/spill` — tool-result / session-reference / pipeline tool-output
 * persist root. Host lists this directory (not all of `{home}`) in
 * `hostReadableRoots`.
 */
export function defaultSpillDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveXrkHome(env), "spill");
}

/**
 * Default stdio MCP `cwd` when Settings omit `cwd`.
 * Keeps servers like `@playwright/mcp` from writing `.playwright-mcp/` into
 * the session workspace (Host process cwd). Explicit Settings `cwd` wins
 * only when it is outside the workspace, or when `cwdAllowWorkspace` is set.
 */
export function defaultMcpStdioCwd(
  serverName: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const safe = serverName.replace(/[^\w.-]+/g, "_") || "server";
  return path.join(resolveXrkHome(env), "mcp-cwd", safe);
}

/** Lexical containment after resolve (no symlink follow). */
function isUnderDir(root: string, candidate: string): boolean {
  const rootAbs = path.resolve(root);
  const candAbs = path.resolve(candidate);
  const rel = path.relative(rootAbs, candAbs);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  );
}

export class McpWorkspaceCwdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpWorkspaceCwdError";
  }
}

export interface ResolveMcpStdioCwdInput {
  readonly serverName: string;
  /** Explicit Settings cwd; omit / empty → product home mcp-cwd. */
  readonly cwd?: string;
  /**
   * Required when resolved cwd sits under `workspaceRoot`.
   * Settings / paste must set this after acknowledging workspace litter risk.
   */
  readonly cwdAllowWorkspace?: boolean;
  /** Host default session workspace (never product home). */
  readonly workspaceRoot: string;
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Resolve stdio MCP cwd: default `{XRK_HOME}/mcp-cwd/<name>`; explicit path
 * wins; workspace paths need `cwdAllowWorkspace: true`.
 */
export function resolveMcpStdioCwd(input: ResolveMcpStdioCwdInput): string {
  const raw = input.cwd?.trim();
  if (!raw) {
    return path.resolve(defaultMcpStdioCwd(input.serverName, input.env));
  }
  const cwd = path.resolve(expandHomePath(raw));
  const workspace = path.resolve(input.workspaceRoot);
  if (isUnderDir(workspace, cwd) && input.cwdAllowWorkspace !== true) {
    throw new McpWorkspaceCwdError(
      `mcp stdio cwd for "${input.serverName}" is under the workspace (${cwd}). ` +
        `Set cwdAllowWorkspace: true to acknowledge litter risk ` +
        `(e.g. .playwright-mcp), or omit cwd to use ~/.xrk/mcp-cwd/<name>.`,
    );
  }
  return cwd;
}
