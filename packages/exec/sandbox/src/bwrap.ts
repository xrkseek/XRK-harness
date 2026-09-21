/**
 * Linux bubblewrap sandbox Provider — rewrites argv to `bwrap … -- cmd`.
 * Same {@link SandboxService} Definition; fail closed off Linux.
 */
import path from "node:path";
import { createPermissiveSandbox, type SandboxService } from "./service.js";
import { SandboxBackendError } from "./docker.js";

export interface BubblewrapSandboxOptions {
  readonly workspaceRoot: string;
  /** bwrap binary. Default `bwrap`. */
  readonly bwrapBin?: string;
  readonly inner?: SandboxService;
  /** Extra args before `--`. */
  readonly extraArgs?: readonly string[];
}

function assertUnderRoot(root: string, cwd: string | undefined): string {
  const absRoot = path.resolve(root);
  const absCwd = path.resolve(cwd ?? absRoot);
  const rel = path.relative(absRoot, absCwd);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new SandboxBackendError(
      `cwd escapes workspace root: ${cwd ?? absCwd}`,
      "SANDBOX_CWD",
    );
  }
  return absCwd;
}

/**
 * Minimal bwrap profile: bind workspace RW, die-with-parent.
 */
export function createBubblewrapSandbox(
  options: BubblewrapSandboxOptions,
): SandboxService {
  const hostRoot = path.resolve(options.workspaceRoot);
  const bwrapBin = options.bwrapBin?.trim() || "bwrap";
  const extra = options.extraArgs ?? [];
  const inner = options.inner ?? createPermissiveSandbox();

  const wrapConfined = (
    confined: readonly string[],
    cwd: string | undefined,
  ): readonly string[] => {
    if (process.platform !== "linux") {
      throw new SandboxBackendError(
        "bubblewrap sandbox is only available on Linux",
        "SANDBOX_PLATFORM",
      );
    }
    const hostCwd = assertUnderRoot(hostRoot, cwd);
    return [
      bwrapBin,
      "--die-with-parent",
      "--new-session",
      "--bind",
      hostRoot,
      hostRoot,
      "--chdir",
      hostCwd,
      ...extra,
      "--",
      ...confined,
    ];
  };

  return {
    wrapArgv(argv, cwd) {
      return wrapConfined(inner.wrapArgv(argv, cwd), cwd);
    },
    async confine(argv, cwd, signal) {
      signal?.throwIfAborted();
      const confined = await inner.confine(argv, cwd, signal);
      signal?.throwIfAborted();
      return wrapConfined(confined, cwd);
    },
  };
}
