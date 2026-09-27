/**
 * Linux bubblewrap sandbox Provider — rewrites argv to `bwrap … -- cmd`.
 * Same {@link SandboxService} Definition; fail closed off Linux.
 *
 * Profile mirrors DSH `bwrapProfileArgs`: read-only root + optional workspace
 * RW bind (not a bare `--bind` of the workspace alone, which left the rest of
 * the host filesystem writable).
 */
import path from "node:path";
import { createPermissiveSandbox, type SandboxService } from "./service.js";
import { SandboxBackendError } from "./docker.js";

/** File-effect posture inside the bwrap namespace. */
export type BubblewrapFsMode = "read-only" | "workspace-write";

export interface BubblewrapProfileOptions {
  readonly workspaceRoot: string;
  /**
   * `workspace-write` (default): `--tmpfs /tmp` + RW bind of the workspace.
   * `read-only`: no writable mounts (workspace stays under `--ro-bind / /`).
   */
  readonly mode?: BubblewrapFsMode;
  /**
   * When false (default), add `--unshare-net` (aligns with docker `--network none`).
   * Set true / `XRK_SANDBOX_BWRAP_NETWORK=bridge|on` to keep host network.
   */
  readonly networkAccess?: boolean;
}

export interface BubblewrapSandboxOptions extends BubblewrapProfileOptions {
  /** bwrap binary. Default `bwrap`. */
  readonly bwrapBin?: string;
  readonly inner?: SandboxService;
  /** Extra args inserted before `--`. */
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
 * Build bwrap profile args (before `--chdir` / `--` / command).
 * Safe to call on any host — confinement itself still requires Linux + bwrap.
 */
export function bwrapProfileArgs(options: BubblewrapProfileOptions): string[] {
  const root = path.resolve(options.workspaceRoot);
  const mode = options.mode ?? "workspace-write";
  const args: string[] = [
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--unshare-pid",
    "--proc",
    "/proc",
    "--die-with-parent",
  ];
  if (mode === "workspace-write") {
    args.push("--tmpfs", "/tmp", "--bind", root, root);
  }
  if (options.networkAccess !== true) {
    args.push("--unshare-net");
  }
  return args;
}

/**
 * DSH-aligned bwrap profile: RO host root, workspace RW (or fully RO), no net
 * by default, die-with-parent. Fail closed off Linux.
 */
export function createBubblewrapSandbox(
  options: BubblewrapSandboxOptions,
): SandboxService {
  const hostRoot = path.resolve(options.workspaceRoot);
  const bwrapBin = options.bwrapBin?.trim() || "bwrap";
  const extra = options.extraArgs ?? [];
  const inner = options.inner ?? createPermissiveSandbox();
  const profile = bwrapProfileArgs({
    workspaceRoot: hostRoot,
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
    ...(options.networkAccess !== undefined
      ? { networkAccess: options.networkAccess }
      : {}),
  });

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
      ...profile,
      "--new-session",
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
