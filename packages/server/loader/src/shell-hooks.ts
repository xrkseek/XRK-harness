/**
 * Shell hooks from Claude/Codex-compatible `hooks.json`.
 * Spawns configured commands with JSON on stdin.
 * Tool events (Pre/PostToolUse) can block; lifecycle events are notify-first.
 * Does not expand `kind: hooks` (in-process) — file-driven scripts only.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  PostHandler,
  PostOutcome,
  PreHandler,
  PreOutcome,
} from "@xrkseek/core-tools";

/** Default per-hook timeout (Hermes-scale; Claude/DSH use 600s — override in config). */
export const DEFAULT_SHELL_HOOK_TIMEOUT_MS = 60_000;

/**
 * Upstream-compatible event names (Claude PascalCase).
 * Codex camelCase aliases are normalized at parse time.
 */
export const SHELL_HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "UserPromptSubmit",
  "Stop",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "SessionStart",
] as const;

export type ShellHookEventName = (typeof SHELL_HOOK_EVENTS)[number];

const EVENT_SET = new Set<string>(SHELL_HOOK_EVENTS);

/** Codex app-server camelCase → Claude PascalCase. */
const EVENT_ALIASES: Record<string, ShellHookEventName> = {
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  permissionRequest: "PermissionRequest",
  userPromptSubmit: "UserPromptSubmit",
  stop: "Stop",
  preCompact: "PreCompact",
  postCompact: "PostCompact",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
  sessionStart: "SessionStart",
};

/** Events whose matcher subject is a tool name. */
const TOOL_MATCH_EVENTS = new Set<ShellHookEventName>([
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
]);

export interface ShellHookCommand {
  readonly command: string;
  /** Tool-name matcher: omit / `*` / `` = all; Claude pipe-literals or unanchored regex. */
  readonly matcher?: string;
  /** Timeout in ms (config `timeout` seconds is converted at parse time). */
  readonly timeoutMs?: number;
}

export type ShellHooksConfig = {
  readonly [K in ShellHookEventName]?: readonly ShellHookCommand[];
};

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

export type CreateShellHookPostOptions = CreateShellHookPreOptions;

export interface ShellLifecycleHooks {
  /** True when at least one command is registered for the event. */
  has(event: ShellHookEventName): boolean;
  /**
   * Fire-and-forget lifecycle hooks (turn / compact / subagent / session).
   * Never throws to callers; failures are dropped (fail-open).
   */
  fire(
    event: ShellHookEventName,
    payload?: Record<string, unknown>,
    signal?: AbortSignal,
  ): void;
  /** Await matched hooks (tests / PreCompact gate). Fail-open on errors. */
  run(
    event: ShellHookEventName,
    payload?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void>;
}

export interface CreateShellLifecycleHooksOptions {
  readonly config: ShellHooksConfig;
  readonly cwd?: string | (() => string);
  readonly env?: NodeJS.ProcessEnv;
  readonly defaultTimeoutMs?: number;
  readonly runner?: ShellHookRunner;
  readonly sessionId?: string;
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

function normalizeEventName(raw: string): ShellHookEventName | undefined {
  if (EVENT_SET.has(raw)) return raw as ShellHookEventName;
  return EVENT_ALIASES[raw];
}

function parseCommandGroups(
  event: ShellHookEventName,
  groups: unknown,
): ShellHookCommand[] {
  if (!Array.isArray(groups)) return [];
  const out: ShellHookCommand[] = [];
  const dropMatcher =
    event === "UserPromptSubmit" ||
    event === "Stop" ||
    event === "PreCompact" ||
    event === "PostCompact";
  for (const rawGroup of groups) {
    const group = asObject(rawGroup);
    if (!group || !Array.isArray(group.hooks)) continue;
    const matcher =
      dropMatcher || typeof group.matcher !== "string"
        ? undefined
        : group.matcher;
    for (const rawHook of group.hooks) {
      const hook = asObject(rawHook);
      if (!hook) continue;
      const type = typeof hook.type === "string" ? hook.type : "command";
      if (type !== "command") continue;
      if (hook.async === true) continue;
      if (typeof hook.command !== "string" || !hook.command.trim()) continue;
      const timeoutSec =
        typeof hook.timeout === "number" &&
        Number.isFinite(hook.timeout) &&
        hook.timeout > 0
          ? hook.timeout
          : typeof hook.timeoutSec === "number" &&
              Number.isFinite(hook.timeoutSec) &&
              hook.timeoutSec > 0
            ? hook.timeoutSec
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

/**
 * Parse Claude/Codex-style `{ hooks: { PreToolUse: [...] } }` or a bare event map.
 * Only `type: command` (default) entries survive; unknown events are ignored.
 */
export function parseShellHooksConfig(raw: unknown): ShellHooksConfig {
  const root = asObject(raw);
  const hooksMap = root ? (asObject(root.hooks) ?? root) : undefined;
  if (!hooksMap) return {};
  const out: { [K in ShellHookEventName]?: ShellHookCommand[] } = {};
  for (const [key, groups] of Object.entries(hooksMap)) {
    const event = normalizeEventName(key);
    if (!event) continue;
    const commands = parseCommandGroups(event, groups);
    if (commands.length === 0) continue;
    const bucket = out[event] ?? [];
    bucket.push(...commands);
    out[event] = bucket;
  }
  return out;
}

/**
 * Parse Claude-style PreToolUse only (back-compat).
 * Prefer {@link parseShellHooksConfig} for multi-event configs.
 */
export function parsePreToolUseHooks(raw: unknown): ShellHookCommand[] {
  return [...(parseShellHooksConfig(raw).PreToolUse ?? [])];
}

/** Read hooks.json paths; missing / malformed files contribute nothing. */
export function loadShellHooksConfig(
  paths: readonly string[],
): ShellHooksConfig {
  const merged: { [K in ShellHookEventName]?: ShellHookCommand[] } = {};
  for (const filePath of paths) {
    try {
      const text = readFileSync(filePath, "utf8");
      const parsed = parseShellHooksConfig(JSON.parse(text) as unknown);
      for (const event of SHELL_HOOK_EVENTS) {
        const cmds = parsed[event];
        if (!cmds || cmds.length === 0) continue;
        const bucket = merged[event] ?? [];
        bucket.push(...cmds);
        merged[event] = bucket;
      }
    } catch {
      // Absent or invalid config must not abort agent composition.
    }
  }
  return merged;
}

/** Read hooks.json paths; PreToolUse only (back-compat). */
export function loadShellHookCommands(
  paths: readonly string[],
): ShellHookCommand[] {
  return [...(loadShellHooksConfig(paths).PreToolUse ?? [])];
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

function postDecisionFromStdout(stdout: string): PostOutcome | null {
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
  if (parsed.decision === "block") {
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : "blocked by shell hook";
    return { action: "block", reason };
  }
  const specific = asObject(parsed.hookSpecificOutput);
  if (specific?.decision === "block") {
    const reason =
      (typeof specific.reason === "string" && specific.reason.trim()) ||
      (typeof parsed.reason === "string" && parsed.reason.trim()) ||
      "blocked by shell hook";
    return { action: "block", reason };
  }
  return null;
}

function additionalContextsFromStdout(stdout: string): string[] {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) return [];
  try {
    const value = JSON.parse(trimmed) as unknown;
    const parsed = asObject(value);
    if (!parsed) return [];
    const out: string[] = [];
    if (typeof parsed.additionalContext === "string" && parsed.additionalContext.trim()) {
      out.push(parsed.additionalContext.trim());
    }
    const specific = asObject(parsed.hookSpecificOutput);
    if (
      typeof specific?.additionalContext === "string" &&
      specific.additionalContext.trim()
    ) {
      out.push(specific.additionalContext.trim());
    }
    return out;
  } catch {
    return [];
  }
}

function resolveCwd(cwd: string | (() => string) | undefined): string {
  if (typeof cwd === "function") return cwd();
  return cwd ?? process.cwd();
}

async function runHookList(options: {
  readonly commands: readonly ShellHookCommand[];
  readonly event: ShellHookEventName;
  readonly payload: Record<string, unknown>;
  readonly matcherSubject?: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly defaultTimeoutMs: number;
  readonly runner: ShellHookRunner;
  readonly signal?: AbortSignal;
}): Promise<ShellHookRunResult[]> {
  const results: ShellHookRunResult[] = [];
  const stdinBase = {
    hook_event_name: options.event,
    cwd: options.cwd,
    ...options.payload,
  };
  for (const hook of options.commands) {
    if (
      TOOL_MATCH_EVENTS.has(options.event) &&
      options.matcherSubject !== undefined &&
      !toolNameMatches(hook.matcher, options.matcherSubject)
    ) {
      continue;
    }
    if (
      (options.event === "SubagentStart" || options.event === "SubagentStop") &&
      hook.matcher !== undefined &&
      !isMatchAll(hook.matcher) &&
      options.matcherSubject !== undefined &&
      !toolNameMatches(hook.matcher, options.matcherSubject)
    ) {
      continue;
    }
    try {
      const result = await options.runner({
        command: hook.command,
        cwd: options.cwd,
        env: options.env,
        stdin: `${JSON.stringify(stdinBase)}\n`,
        timeoutMs: hook.timeoutMs ?? options.defaultTimeoutMs,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      results.push(result);
    } catch {
      // fail-open
    }
  }
  return results;
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
    const cwd = resolveCwd(options.cwd);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(options.env ?? {}),
    };
    const results = await runHookList({
      commands,
      event: "PreToolUse",
      payload: {
        tool_name: ctx.call.name,
        tool_input: ctx.args,
        tool_use_id: ctx.call.id,
      },
      matcherSubject: ctx.call.name,
      cwd,
      env,
      defaultTimeoutMs,
      runner,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    for (const result of results) {
      if (result.exitCode === 2) {
        const reason =
          result.stderr.trim() || "blocked by shell hook (exit 2)";
        return { action: "deny", reason };
      }
      if (result.exitCode === 0) {
        const fromJson = decisionFromStdout(result.stdout);
        if (fromJson) return fromJson;
      }
    }
    return { action: "continue", args: ctx.args };
  };
}

/**
 * PostHandler for PostToolUse. Exit 2 / JSON decision:block → block;
 * additionalContext folds into the pipeline; other failures fail-open.
 */
export function createShellHookPost(
  options: CreateShellHookPostOptions,
): PostHandler {
  const commands = options.commands;
  const runner = options.runner ?? defaultRunner;
  const defaultTimeoutMs =
    options.defaultTimeoutMs ?? DEFAULT_SHELL_HOOK_TIMEOUT_MS;

  return async (ctx) => {
    if (commands.length === 0) {
      return { action: "accept" };
    }
    const cwd = resolveCwd(options.cwd);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(options.env ?? {}),
    };
    const results = await runHookList({
      commands,
      event: "PostToolUse",
      payload: {
        tool_name: ctx.call.name,
        tool_input: ctx.args,
        tool_use_id: ctx.call.id,
        tool_response: ctx.result
          ? {
              content: ctx.result.content,
              isError: ctx.result.isError === true,
            }
          : undefined,
        skipped_body: ctx.skippedBody === true,
      },
      matcherSubject: ctx.call.name,
      cwd,
      env,
      defaultTimeoutMs,
      runner,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    for (const result of results) {
      if (result.exitCode === 2) {
        const reason =
          result.stderr.trim() || "blocked by shell hook (exit 2)";
        return { action: "block", reason };
      }
      if (result.exitCode === 0) {
        for (const text of additionalContextsFromStdout(result.stdout)) {
          ctx.additionalContexts.push(text);
        }
        const blocked = postDecisionFromStdout(result.stdout);
        if (blocked) return blocked;
      }
    }
    return { action: "accept" };
  };
}

/**
 * Lifecycle shell hooks (turn / compact / subagent / session).
 * Notify-first: never blocks the caller; use {@link ShellLifecycleHooks.run} to await.
 */
export function createShellLifecycleHooks(
  options: CreateShellLifecycleHooksOptions,
): ShellLifecycleHooks {
  const config = options.config;
  const runner = options.runner ?? defaultRunner;
  const defaultTimeoutMs =
    options.defaultTimeoutMs ?? DEFAULT_SHELL_HOOK_TIMEOUT_MS;
  const sessionId = options.sessionId;

  const run = async (
    event: ShellHookEventName,
    payload: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<void> => {
    const commands = config[event];
    if (!commands || commands.length === 0) return;
    const cwd = resolveCwd(options.cwd);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(options.env ?? {}),
    };
    const matcherSubject =
      typeof payload.agent_type === "string"
        ? payload.agent_type
        : typeof payload.tool_name === "string"
          ? payload.tool_name
          : "general-purpose";
    await runHookList({
      commands,
      event,
      payload: {
        ...(sessionId !== undefined ? { session_id: sessionId } : {}),
        ...payload,
      },
      matcherSubject,
      cwd,
      env,
      defaultTimeoutMs,
      runner,
      ...(signal ? { signal } : {}),
    });
  };

  return {
    has(event) {
      return (config[event]?.length ?? 0) > 0;
    },
    fire(event, payload, signal) {
      void run(event, payload, signal).catch(() => {
        /* fail-open */
      });
    },
    run,
  };
}

/** Codex/Claude PermissionRequest decision before the human approval UI. */
export type PermissionRequestDecision =
  | { readonly action: "allow" }
  | { readonly action: "deny"; readonly reason: string };

export interface CreatePermissionRequestGateOptions {
  readonly commands: readonly ShellHookCommand[];
  readonly cwd?: string | (() => string);
  readonly env?: NodeJS.ProcessEnv;
  readonly defaultTimeoutMs?: number;
  readonly runner?: ShellHookRunner;
  readonly sessionId?: string;
}

function permissionDecisionFromStdout(
  stdout: string,
): PermissionRequestDecision | null {
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
  const specific = asObject(parsed.hookSpecificOutput);
  const specificDecision =
    typeof specific?.decision === "string" ? specific.decision : undefined;
  const top =
    typeof parsed.decision === "string" ? parsed.decision : undefined;
  const decision = specificDecision ?? top;
  if (decision === "allow" || decision === "approve") {
    return { action: "allow" };
  }
  if (decision === "deny" || decision === "block") {
    const reason =
      (typeof specific?.reason === "string" && specific.reason.trim()) ||
      (typeof parsed.reason === "string" && parsed.reason.trim()) ||
      "denied by PermissionRequest hook";
    return { action: "deny", reason };
  }
  const permission = specific?.permissionDecision;
  if (permission === "allow") return { action: "allow" };
  if (permission === "deny") {
    const reason =
      (typeof specific?.permissionDecisionReason === "string" &&
        specific.permissionDecisionReason.trim()) ||
      (typeof parsed.reason === "string" && parsed.reason.trim()) ||
      "denied by PermissionRequest hook";
    return { action: "deny", reason };
  }
  return null;
}

/**
 * Run Claude/Codex `PermissionRequest` command hooks before the human UI.
 * Exit 2 / JSON deny → deny; JSON allow → allow; otherwise undefined (ask human).
 */
export function createPermissionRequestGate(
  options: CreatePermissionRequestGateOptions,
): (args: {
  readonly toolName: string;
  readonly toolInput?: unknown;
  readonly toolUseId?: string;
  readonly category?: string;
  readonly signal?: AbortSignal;
}) => Promise<PermissionRequestDecision | undefined> {
  const commands = options.commands;
  const runner = options.runner ?? defaultRunner;
  const defaultTimeoutMs =
    options.defaultTimeoutMs ?? DEFAULT_SHELL_HOOK_TIMEOUT_MS;

  return async (args) => {
    if (commands.length === 0) return undefined;
    const cwd = resolveCwd(options.cwd);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(options.env ?? {}),
    };
    const results = await runHookList({
      commands,
      event: "PermissionRequest",
      payload: {
        ...(options.sessionId !== undefined
          ? { session_id: options.sessionId }
          : {}),
        tool_name: args.toolName,
        tool_input: args.toolInput,
        ...(args.toolUseId !== undefined
          ? { tool_use_id: args.toolUseId }
          : {}),
        ...(args.category !== undefined ? { category: args.category } : {}),
      },
      matcherSubject: args.toolName,
      cwd,
      env,
      defaultTimeoutMs,
      runner,
      ...(args.signal ? { signal: args.signal } : {}),
    });
    for (const result of results) {
      if (result.exitCode === 2) {
        return {
          action: "deny",
          reason: result.stderr.trim() || "denied by PermissionRequest hook (exit 2)",
        };
      }
      if (result.exitCode === 0) {
        const fromJson = permissionDecisionFromStdout(result.stdout);
        if (fromJson) return fromJson;
      }
    }
    return undefined;
  };
}
