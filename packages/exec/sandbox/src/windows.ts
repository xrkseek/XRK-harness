/**
 * Windows write-isolation sandbox Provider.
 *
 * Permission model mirrors Codex `codex-rs/windows-sandbox-rs`:
 * AppContainer + restricted token, read-only vs writable roots, network
 * egress off by default. We deliberately do **not** port that Rust service —
 * this module is only the TS-side bridge that maps the XRK permission model
 * onto a helper binary's argv.
 *
 * Fail-closed posture:
 * - non-Windows host  → `SANDBOX_PLATFORM`
 * - helper missing    → `SANDBOX_UNAVAILABLE`
 * Never silently degrades to bare argv. Tools keep the same
 * {@link SandboxService} Definition; only the Provider changes.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { createPermissiveSandbox, type SandboxService } from "./service.js";
import { SandboxBackendError } from "./docker.js";

/**
 * Structurally identical to `@xrkseek/protocol` `SandboxMode` (kept local so
 * this package stays dependency-free, matching `DockerNetworkMode`).
 */
export type WindowsSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface WindowsSandboxOptions {
  /** Host workspace root — always the primary writable root. */
  readonly workspaceRoot: string;
  /**
   * Codex-style helper binary that performs AppContainer / restricted-token
   * setup. Required: without a runtime we fail closed (and say so).
   */
  readonly helper: string;
  /** Permission posture. Default `workspace-write`. */
  readonly mode?: WindowsSandboxMode;
  /** Additional writable roots (only honored under `workspace-write`). */
  readonly writableRoots?: readonly string[];
  /** Extra roots pinned read-only on top of the workspace. */
  readonly readOnlyRoots?: readonly string[];
  /** Allow network egress. Default false (Codex posture). */
  readonly networkAccess?: boolean;
  /** Extra args inserted before the `--` argv separator. */
  readonly extraArgs?: readonly string[];
  /** Applied to the original argv before helper wrapping. */
  readonly inner?: SandboxService;
  /** Host platform override (tests). Default `process.platform`. */
  readonly platform?: NodeJS.Platform;
}

export interface WindowsSandboxCapability {
  readonly available: boolean;
  readonly helper?: string;
  readonly reason?: string;
}

const MODES: readonly WindowsSandboxMode[] = [
  "read-only",
  "workspace-write",
  "danger-full-access",
];

export function isWindowsSandboxMode(value: unknown): value is WindowsSandboxMode {
  return MODES.includes(value as WindowsSandboxMode);
}

/** Helper binary from `XRK_SANDBOX_WINDOWS_HELPER` (trimmed), if set. */
export function resolveWindowsSandboxHelper(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = String(env.XRK_SANDBOX_WINDOWS_HELPER ?? "").trim();
  return raw || undefined;
}

/**
 * Probe whether the Windows sandbox can actually run — for honest status
 * text instead of a mid-execution surprise. Never throws.
 */
export function windowsSandboxCapability(
  options: {
    readonly helper?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly platform?: NodeJS.Platform;
  } = {},
): WindowsSandboxCapability {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return {
      available: false,
      reason: "windows sandbox is only available on Windows",
    };
  }
  const helper =
    options.helper?.trim() || resolveWindowsSandboxHelper(options.env ?? process.env);
  if (!helper) {
    return {
      available: false,
      reason:
        "windows sandbox requires XRK_SANDBOX_WINDOWS_HELPER (Codex-style helper binary)",
    };
  }
  // A bare command name resolves via PATH at spawn time; only stat real paths.
  const looksLikePath =
    path.isAbsolute(helper) || helper.includes("/") || helper.includes("\\");
  if (looksLikePath && !existsSync(helper)) {
    return {
      available: false,
      helper,
      reason: `windows sandbox helper not found: ${helper}`,
    };
  }
  return { available: true, helper };
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
 * Build the helper argv contract:
 *
 *   <helper> --mode <mode> --cwd <hostCwd> [--network|--no-network]
 *            --writable-root <p>... --read-only-root <p>... [extra] -- <argv...>
 *
 * The helper owns ACL grants and token setup; we only describe intent.
 */
export function createWindowsSandbox(options: WindowsSandboxOptions): SandboxService {
  const helper = options.helper?.trim();
  if (!helper) {
    throw new SandboxBackendError(
      "windows sandbox requires a helper binary (XRK_SANDBOX_WINDOWS_HELPER)",
      "SANDBOX_UNAVAILABLE",
    );
  }
  const mode = options.mode ?? "workspace-write";
  if (!isWindowsSandboxMode(mode)) {
    throw new SandboxBackendError(
      `unknown windows sandbox mode: ${String(mode)}`,
      "SANDBOX_CONFIG",
    );
  }

  const hostRoot = path.resolve(options.workspaceRoot);
  const inner = options.inner ?? createPermissiveSandbox();
  const extra = options.extraArgs ?? [];
  const networkAccess = options.networkAccess ?? false;
  const platform = options.platform ?? process.platform;

  // read-only → workspace is read-only; workspace-write / danger-full-access
  // keep it writable (the preset already skips confine for danger-full-access).
  const writable =
    mode === "read-only"
      ? []
      : [hostRoot, ...(options.writableRoots ?? []).map((r) => path.resolve(r))];
  const readOnly = [
    ...(mode === "read-only" ? [hostRoot] : []),
    ...(options.readOnlyRoots ?? []).map((r) => path.resolve(r)),
  ];

  const wrapConfined = (
    confined: readonly string[],
    cwd: string | undefined,
  ): readonly string[] => {
    if (platform !== "win32") {
      throw new SandboxBackendError(
        "windows sandbox is only available on Windows",
        "SANDBOX_PLATFORM",
      );
    }
    const hostCwd = assertUnderRoot(hostRoot, cwd);
    return [
      helper,
      "--mode",
      mode,
      "--cwd",
      hostCwd,
      networkAccess ? "--network" : "--no-network",
      ...writable.flatMap((p) => ["--writable-root", p]),
      ...readOnly.flatMap((p) => ["--read-only-root", p]),
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
