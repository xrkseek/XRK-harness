import path from "node:path";
import type { MonotonicGuard } from "@xrkseek/core-tools";

export interface SandboxService {
  wrapArgv(argv: readonly string[], cwd?: string): readonly string[];
}

/** Provider: no-op wrap. */
export function createPermissiveSandbox(): SandboxService {
  return {
    wrapArgv(argv) {
      return [...argv];
    },
  };
}

export interface WorkspaceSandboxOptions {
  readonly root: string;
  readonly inner?: SandboxService;
}

/** Force cwd under workspace root (validated at wrap time). */
export function createWorkspaceSandbox(
  options: WorkspaceSandboxOptions,
): SandboxService {
  const root = path.resolve(options.root);
  const inner = options.inner ?? createPermissiveSandbox();
  return {
    wrapArgv(argv, cwd) {
      if (cwd) {
        const abs = path.resolve(cwd);
        const rel = path.relative(root, abs);
        if (
          rel === ".." ||
          rel.startsWith(`..${path.sep}`) ||
          path.isAbsolute(rel)
        ) {
          throw new Error(`cwd escapes workspace root: ${cwd}`);
        }
      }
      return inner.wrapArgv(argv, cwd);
    },
  };
}

export interface DenyListOptions {
  readonly patterns?: readonly RegExp[];
  readonly inner?: SandboxService;
}

const DEFAULT_DENY = [
  /\brm\s+(-[^\s]*\s+)*-rf\s+\/\b/i,
  /\brm\s+(-[^\s]*\s+)*-rf\s+\/\s*$/i,
  /\bdel\s+\/s\s+\/q\s+[a-z]:\\\b/i,
];

export class SandboxDenyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxDenyError";
  }
}

export function createDenyListSandbox(
  options: DenyListOptions = {},
): SandboxService {
  const patterns = options.patterns ?? DEFAULT_DENY;
  const inner = options.inner ?? createPermissiveSandbox();
  return {
    wrapArgv(argv, cwd) {
      const joined = argv.join(" ");
      for (const re of patterns) {
        if (re.test(joined)) {
          throw new SandboxDenyError(`denied argv: ${joined}`);
        }
      }
      return inner.wrapArgv(argv, cwd);
    },
  };
}

/**
 * Guard for bash tool: run wrapArgv on reconstructed argv before execute.
 * Deny → guard deny; other tools abstain.
 */
export function createSandboxWrapGuard(
  sandbox: SandboxService,
  options: { toolName?: string; cwd?: string } = {},
): MonotonicGuard {
  const toolName = options.toolName ?? "bash";
  return (ctx) => {
    if (ctx.call.name !== toolName) return "abstain";
    const command = String(
      (ctx.args as { command?: string } | undefined)?.command ?? "",
    );
    const argv = ["bash", "-lc", command];
    try {
      const wrapped = sandbox.wrapArgv(argv, options.cwd);
      // Mutate args for wrapArgv consumers (ToolPipelineContext.args is mutable).
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
      ctx.denyReason =
        err instanceof Error ? err.message : String(err);
      return "deny";
    }
  };
}
