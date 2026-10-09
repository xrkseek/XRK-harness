/**
 * Workspace-write / read-only path overreach → pipeline `ask`
 * (`path-overreach:` reason). Face broker applies 5s fail-closed +
 * Once / Whitelist / Deny.
 */

import path from "node:path";
import type { ApprovalDisplayReason, PreHandler } from "@xrkseek/core-tools";
import type { PathAccessMode } from "@xrkseek/protocol";
import {
  PathEscapeError,
  resolveUnderHostRoots,
  resolveWithinRoot,
  resolveWritablePath,
} from "./paths.js";

const WRITE_TOOLS = new Map<string, readonly string[]>([
  ["write_file", ["path", "file_path"]],
  ["apply_edit", ["path", "file_path"]],
  ["apply_patch", ["path", "file_path"]],
]);

const READ_TOOLS = new Map<string, readonly string[]>([
  ["read_file", ["path", "file_path"]],
  ["glob", ["path", "target_directory", "root"]],
  ["grep", ["path", "target_directory", "root"]],
]);

/** English audit prefix — Face classifyApproval keys off this. */
export const PATH_OVERREACH_REASON_PREFIX = "path-overreach:";

export interface PathOverreachPreOptions {
  readonly root: () => string;
  readonly pathAccessMode: () => PathAccessMode;
  /** Settings + session permanent/once writable object paths. */
  readonly listWritableAllowlist: () => readonly string[];
  /** hostReadable ∪ writable ∪ session (reads). */
  readonly listReadableAllowlist: () => readonly string[];
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstPathArg(
  args: unknown,
  keys: readonly string[],
): string | undefined {
  const obj = asObject(args);
  if (!obj) return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function bashCwd(args: unknown): string | undefined {
  const obj = asObject(args);
  const cwd = obj?.cwd;
  return typeof cwd === "string" && cwd.trim() ? cwd.trim() : undefined;
}

function displayReasonFor(absPath: string, access: "read" | "write"): ApprovalDisplayReason {
  const short = absPath;
  if (access === "read") {
    return {
      en: `Allow reading outside the workspace?\n${short}`,
      zh: `允许读取工作区外路径？\n${short}`,
    };
  }
  return {
    en: `Allow writing outside the workspace?\n${short}`,
    zh: `允许写入工作区外路径？\n${short}`,
  };
}

function escapesWritable(
  root: string,
  allowlist: readonly string[],
  userPath: string,
): string | undefined {
  try {
    resolveWritablePath(root, allowlist, userPath);
    return undefined;
  } catch (err) {
    if (err instanceof PathEscapeError) return path.resolve(userPath);
    throw err;
  }
}

function escapesReadable(
  root: string,
  allowlist: readonly string[],
  userPath: string,
): string | undefined {
  try {
    resolveWithinRoot(root, userPath);
    return undefined;
  } catch (err) {
    if (!(err instanceof PathEscapeError) || !path.isAbsolute(userPath)) {
      if (err instanceof PathEscapeError) return path.resolve(root, userPath);
      throw err;
    }
    if (allowlist.length === 0) return path.resolve(userPath);
    try {
      resolveUnderHostRoots(allowlist, userPath);
      return undefined;
    } catch {
      return path.resolve(userPath);
    }
  }
}

/**
 * Soft floor: absolute paths outside workspace + object allowlist → ask.
 * No-op when `pathAccessMode` is `open`. Relative paths stay under root.
 */
export function createPathOverreachPre(
  options: PathOverreachPreOptions,
): PreHandler {
  return async (ctx) => {
    if (options.pathAccessMode() === "open") {
      return { action: "continue", args: ctx.args };
    }

    const name = ctx.call.name;
    let access: "read" | "write" | undefined;
    let userPath: string | undefined;

    const writeKeys = WRITE_TOOLS.get(name);
    if (writeKeys) {
      access = "write";
      userPath = firstPathArg(ctx.args, writeKeys);
    } else {
      const readKeys = READ_TOOLS.get(name);
      if (readKeys) {
        access = "read";
        userPath = firstPathArg(ctx.args, readKeys);
      } else if (name === "bash" || name === "pwsh") {
        access = "write";
        userPath = bashCwd(ctx.args);
      }
    }

    if (!access || !userPath) {
      return { action: "continue", args: ctx.args };
    }

    // Relative paths resolve under workspace — no overreach card.
    if (!path.isAbsolute(userPath)) {
      return { action: "continue", args: ctx.args };
    }

    const root = options.root();
    const escaped =
      access === "write"
        ? escapesWritable(root, options.listWritableAllowlist(), userPath)
        : escapesReadable(root, options.listReadableAllowlist(), userPath);

    if (!escaped) {
      return { action: "continue", args: ctx.args };
    }

    const reason = `${PATH_OVERREACH_REASON_PREFIX} ${access} ${escaped}`;
    return {
      action: "ask",
      reason,
      displayReason: displayReasonFor(escaped, access),
      error: {
        name: "PathEscapeError",
        code: "path-escape",
        reason: `path escapes workspace root: ${userPath}`,
      },
    };
  };
}
