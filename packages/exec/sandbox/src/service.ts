import path from "node:path";
import type { MonotonicGuard } from "@xrkseek/core-tools";
import { DEFAULT_HARDLINE_ARGV_PATTERNS } from "./hardline.js";

export interface SandboxService {
  /** Sync wrap (guards / cheap checks). Prefer {@link confine} on spawn paths. */
  wrapArgv(argv: readonly string[], cwd?: string): readonly string[];
  /**
   * Async confinement (DSH `SandboxProvider.confine`): cancellable while the
   * provider resolves policy / runners. Sync backends still honor `signal`.
   */
  confine(
    argv: readonly string[],
    cwd?: string,
    signal?: AbortSignal,
  ): Promise<readonly string[]>;
}

/** Run sync wrap under an optional abort signal (DSH-style prep cancel). */
export async function confineWithSignal(
  wrap: (argv: readonly string[], cwd?: string) => readonly string[],
  argv: readonly string[],
  cwd?: string,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  signal?.throwIfAborted();
  const out = wrap(argv, cwd);
  signal?.throwIfAborted();
  return [...out];
}

/** Provider: no-op wrap. */
export function createPermissiveSandbox(): SandboxService {
  return {
    wrapArgv(argv) {
      return [...argv];
    },
    confine(argv, cwd, signal) {
      return confineWithSignal((a) => [...a], argv, cwd, signal);
    },
  };
}

export interface WorkspaceSandboxOptions {
  readonly root: string;
  readonly inner?: SandboxService;
}

function assertCwdUnderRoot(root: string, cwd: string | undefined): void {
  if (!cwd) return;
  const abs = path.resolve(cwd);
  const rel = path.relative(root, abs);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`cwd escapes workspace root: ${cwd}`);
  }
}

/** Force cwd under workspace root (validated at wrap / confine time). */
export function createWorkspaceSandbox(
  options: WorkspaceSandboxOptions,
): SandboxService {
  const root = path.resolve(options.root);
  const inner = options.inner ?? createPermissiveSandbox();
  return {
    wrapArgv(argv, cwd) {
      assertCwdUnderRoot(root, cwd);
      return inner.wrapArgv(argv, cwd);
    },
    async confine(argv, cwd, signal) {
      signal?.throwIfAborted();
      assertCwdUnderRoot(root, cwd);
      return inner.confine(argv, cwd, signal);
    },
  };
}

export interface DenyListOptions {
  readonly patterns?: readonly RegExp[];
  readonly inner?: SandboxService;
}

const DEFAULT_DENY = DEFAULT_HARDLINE_ARGV_PATTERNS;

export class SandboxDenyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxDenyError";
  }
}

function assertNotDenied(
  patterns: readonly RegExp[],
  argv: readonly string[],
): void {
  const joined = argv.join(" ");
  for (const re of patterns) {
    if (re.test(joined)) {
      throw new SandboxDenyError(`denied argv: ${joined}`);
    }
  }
}

export function createDenyListSandbox(
  options: DenyListOptions = {},
): SandboxService {
  const patterns = options.patterns ?? DEFAULT_DENY;
  const inner = options.inner ?? createPermissiveSandbox();
  return {
    wrapArgv(argv, cwd) {
      assertNotDenied(patterns, argv);
      return inner.wrapArgv(argv, cwd);
    },
    async confine(argv, cwd, signal) {
      signal?.throwIfAborted();
      assertNotDenied(patterns, argv);
      return inner.confine(argv, cwd, signal);
    },
  };
}

/**
 * Guard for bash tool: run confine on reconstructed argv before execute.
 * Deny → guard deny; other tools abstain.
 */
export function createSandboxWrapGuard(
  sandbox: SandboxService,
  options: { toolName?: string; cwd?: string } = {},
): MonotonicGuard {
  const toolName = options.toolName ?? "bash";
  return async (ctx) => {
    if (ctx.call.name !== toolName) return "abstain";
    const command = String(
      (ctx.args as { command?: string } | undefined)?.command ?? "",
    );
    const argv = ["bash", "-lc", command];
    try {
      const wrapped = await sandbox.confine(argv, options.cwd, ctx.signal);
      const prev =
        ctx.args !== null && typeof ctx.args === "object"
          ? { ...(ctx.args as Record<string, unknown>) }
          : {};
      ctx.args = {
        ...prev,
        command,
        __wrappedArgv: wrapped,
      };
      return "allow";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        ctx.denyReason = err.message || "aborted";
        return "deny";
      }
      ctx.denyReason = err instanceof Error ? err.message : String(err);
      return "deny";
    }
  };
}
