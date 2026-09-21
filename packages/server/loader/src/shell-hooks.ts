/**
 * Shell PreToolUse hooks (Claude/DSH-compatible subset).
 * Spawns configured commands with JSON on stdin; maps block → PreHandler deny.
 * Does not expand `kind: hooks` (in-process) — file-driven scripts only.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PreHandler, PreOutcome } from "@xrkseek/core-tools";

/** Default per-hook timeout (Hermes-scale; Claude/DSH use 600s — override in config). */
export const DEFAULT_SHELL_HOOK_TIMEOUT_MS = 60_000;

export interface ShellHookCommand {
  readonly command: string;
  /** Tool-name matcher: omit / `*` / `` = all; Claude pipe-literals or unanchored regex. */
  readonly matcher?: string;
  /** Timeout in ms (config `timeout` seconds is converted at parse time). */
  readonly timeoutMs?: number;
}

export interface ShellHookRunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type ShellHookRunner = (args: {
  readonly command: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}) => Promise<ShellHookRunResult>;

export interface CreateShellHookPreOptions {
  readonly commands: readonly ShellHookCommand[];
  /** Working directory for hook processes (session workspace). */
  readonly cwd?: string | (() => string);
  readonly env?: NodeJS.ProcessEnv;
  readonly defaultTimeoutMs?: number;
  /** Injectable spawn (tests). Default: `child_process` shell spawn. */
  readonly runner?: ShellHookRunner;
}

const CLAUDE_LITERAL = /^[A-Za-z0-9_|]+$/;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isMatchAll(matcher: string | undefined): boolean {
  return matcher === undefined || matcher === "" || matcher === "*";
}

/** Claude pipe-literals or unanchored regex; invalid regex → non-match. */
export function toolNameMatches(
  matcher: string | undefined,
  toolName: string,
): boolean {
  if (isMatchAll(matcher)) return true;
  const pattern = matcher as string;
  if (CLAUDE_LITERAL.test(pattern)) {
    return pattern.split("|").includes(toolName);
  }
  try {
    return new RegExp(pattern).test(toolName);
  } catch {
    return false;
  }
}

/**
 * Parse Claude-style `{ hooks: { PreToolUse: [...] } }` or a bare event map.
 * Only `type: command` (default) entries survive; other events are ignored.
 */
export function parsePreToolUseHooks(raw: unknown): ShellHookCommand[] {
  const root = asObject(raw);
  const hooksMap = root ? (asObject(root.hooks) ?? root) : undefined;
  if (!hooksMap) return [];
  const groups = hooksMap.PreToolUse;
  if (!Array.isArray(groups)) return [];
  const out: ShellHookCommand[] = [];
  for (const rawGroup of groups) {
    const group = asObject(rawGroup);
    if (!group || !Array.isArray(group.hooks)) continue;
    const matcher =
      typeof group.matcher === "string" ? group.matcher : undefined;
    for (const rawHook of group.hooks) {
      const hook = asObject(rawHook);
      if (!hook) continue;
      const type = typeof hook.type === "string" ? hook.type : "command";
      if (type !== "command") continue;
      if (typeof hook.command !== "string" || !hook.command.trim()) continue;
      const timeoutSec =
        typeof hook.timeout === "number" &&
        Number.isFinite(hook.timeout) &&
        hook.timeout > 0
          ? hook.timeout
          : undefined;
      out.push({
        command: hook.command,
        ...(matcher !== undefined ? { matcher } : {}),
        ...(timeoutSec !== undefined
          ? { timeoutMs: Math.floor(timeoutSec * 1000) }
          : {}),
      });
    }
  }
  return out;
}

/** Read hooks.json paths; missing / malformed files contribute nothing. */
export function loadShellHookCommands(
  paths: readonly string[],
): ShellHookCommand[] {
  const out: ShellHookCommand[] = [];
  for (const filePath of paths) {
    try {
      const text = readFileSync(filePath, "utf8");
      out.push(...parsePreToolUseHooks(JSON.parse(text) as unknown));
    } catch {
      // Absent or invalid config must not abort agent composition.
    }
  }
  return out;
}

/** Default paths: product home then workspace `.xrk/hooks.json`. */
export function defaultShellHookPaths(
  workspaceRoot: string,
  productHome: string,
): string[] {
  return [
    path.join(productHome, "hooks.json"),
    path.join(workspaceRoot, ".xrk", "hooks.json"),
  ];
}

function defaultRunner(args: {
  readonly command: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}): Promise<ShellHookRunResult> {
  return new Promise((resolve) => {
    const child = spawn(args.command, {
      shell: true,
      cwd: args.cwd,
      env: args.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: ShellHookRunResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ exitCode: null, stdout, stderr: stderr || "shell hook timeout" });
    }, args.timeoutMs);
    const onAbort = (): void => {
      child.kill();
      finish({ exitCode: null, stdout, stderr: stderr || "shell hook aborted" });
    };
    args.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      args.signal?.removeEventListener("abort", onAbort);
      finish({ exitCode: null, stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      args.signal?.removeEventListener("abort", onAbort);
      finish({ exitCode: code, stdout, stderr });
    });
    try {
      child.stdin?.end(args.stdin);
    } catch {
      // Broken pipe before write — close handler settles.
    }
  });
}

function decisionFromStdout(stdout: string): PreOutcome | null {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (!asObject(value)) return null;
    parsed = value as Record<string, unknown>;
  } catch {
    return null;
  }
  const top = parsed.decision;
  if (top === "block") {
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : "blocked by shell hook";
    return { action: "deny", reason };
  }
  const specific = asObject(parsed.hookSpecificOutput);
  const permission = specific?.permissionDecision;
  if (permission === "deny") {
    const reason =
      (typeof specific?.permissionDecisionReason === "string" &&
        specific.permissionDecisionReason.trim()) ||
      (typeof parsed.reason === "string" && parsed.reason.trim()) ||
      "blocked by shell hook";
    return { action: "deny", reason };
  }
  if (permission === "ask") {
    const reason =
      (typeof specific?.permissionDecisionReason === "string" &&
        specific.permissionDecisionReason.trim()) ||
      (typeof parsed.reason === "string" && parsed.reason.trim()) ||
      "shell hook asks for approval";
    return { action: "ask", reason };
  }
  return null;
}

/**
 * PreHandler that runs matched shell hooks in order.
 * Exit 2 or JSON deny → deny; spawn/timeout/other → fail-open continue.
 */
export function createShellHookPre(
  options: CreateShellHookPreOptions,
): PreHandler {
  const commands = options.commands;
  const runner = options.runner ?? defaultRunner;
  const defaultTimeoutMs =
    options.defaultTimeoutMs ?? DEFAULT_SHELL_HOOK_TIMEOUT_MS;

  return async (ctx) => {
    if (commands.length === 0) {
      return { action: "continue", args: ctx.args };
    }
    const cwd =
      typeof options.cwd === "function"
        ? options.cwd()
        : (options.cwd ?? process.cwd());
    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: ctx.call.name,
      tool_input: ctx.args,
      tool_use_id: ctx.call.id,
      cwd,
    });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(options.env ?? {}),
    };

    for (const hook of commands) {
      if (!toolNameMatches(hook.matcher, ctx.call.name)) continue;
      let result: ShellHookRunResult;
      try {
        result = await runner({
          command: hook.command,
          cwd,
          env,
          stdin: `${payload}\n`,
          timeoutMs: hook.timeoutMs ?? defaultTimeoutMs,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
      } catch {
        continue;
      }
      if (result.exitCode === 2) {
        const reason =
          result.stderr.trim() || "blocked by shell hook (exit 2)";
        return { action: "deny", reason };
      }
      if (result.exitCode === 0) {
        const fromJson = decisionFromStdout(result.stdout);
        if (fromJson) return fromJson;
      }
      // Other exits / null (timeout) → fail-open.
    }
    return { action: "continue", args: ctx.args };
  };
}
