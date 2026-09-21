/**
 * Resolve a SandboxService stack from Host options / env.
 * Tools keep the same Definition; only the Provider chain changes.
 */
import {
  createDenyListSandbox,
  createPermissiveSandbox,
  createWorkspaceSandbox,
  type SandboxService,
} from "./service.js";
import { createDockerSandbox, type DockerNetworkMode } from "./docker.js";
import { createBubblewrapSandbox } from "./bwrap.js";
import { SandboxBackendError } from "./docker.js";
import {
  createWindowsSandbox,
  isWindowsSandboxMode,
  resolveWindowsSandboxHelper,
  type WindowsSandboxMode,
} from "./windows.js";

export type SandboxBackendKind = "workspace" | "docker" | "bwrap" | "windows";

export interface ResolveSandboxOptions {
  readonly workspaceRoot: string;
  /**
   * Backend kind. Default `workspace` (deny-list + cwd jail).
   * `docker` / `bwrap` are first-class container / OS isolation Providers.
   * `windows` bridges to a Codex-style helper binary and fails closed
   * without it.
   */
  readonly backend?: SandboxBackendKind;
  readonly env?: NodeJS.ProcessEnv;
  /** When true, skip WorkspaceSandbox path.resolve (SSH remote cwd). */
  readonly remoteExecution?: boolean;
  readonly dockerImage?: string;
  readonly dockerNetwork?: DockerNetworkMode;
  readonly dockerBin?: string;
  readonly dockerExtraRunArgs?: readonly string[];
  readonly bwrapBin?: string;
  readonly bwrapExtraArgs?: readonly string[];
  /** Windows helper binary (default `XRK_SANDBOX_WINDOWS_HELPER`). */
  readonly windowsHelper?: string;
  /** Windows permission posture (default `workspace-write`). */
  readonly windowsMode?: WindowsSandboxMode;
  /** Windows network egress (default false). */
  readonly windowsNetwork?: boolean;
  readonly windowsExtraArgs?: readonly string[];
}

function backendFromEnv(env: NodeJS.ProcessEnv): SandboxBackendKind {
  const raw = String(env.XRK_SANDBOX_BACKEND ?? "")
    .trim()
    .toLowerCase();
  if (raw === "docker" || raw === "bwrap" || raw === "workspace" || raw === "windows") {
    return raw;
  }
  return "workspace";
}

/**
 * Build the recommended stack for a Host session.
 * - workspace (default): WorkspaceSandbox(DenyList(Permissive))
 * - docker: DenyList → Docker (mount workspace); WorkspaceSandbox when not remote
 * - bwrap: DenyList → bubblewrap (Linux)
 * - windows: DenyList → Codex-style helper (write isolation); fails closed
 */
export function createSandboxStack(options: ResolveSandboxOptions): SandboxService {
  const env = options.env ?? process.env;
  const backend = options.backend ?? backendFromEnv(env);
  const deny = createDenyListSandbox({
    inner: createPermissiveSandbox(),
  });

  let core: SandboxService = deny;

  if (backend === "docker") {
    const image =
      options.dockerImage?.trim() || String(env.XRK_SANDBOX_DOCKER_IMAGE ?? "").trim();
    if (!image) {
      throw new SandboxBackendError(
        "docker sandbox requires XRK_SANDBOX_DOCKER_IMAGE or dockerImage",
        "SANDBOX_CONFIG",
      );
    }
    const networkRaw = String(
      options.dockerNetwork ?? env.XRK_SANDBOX_DOCKER_NETWORK ?? "none",
    )
      .trim()
      .toLowerCase();
    const network: DockerNetworkMode = networkRaw === "bridge" ? "bridge" : "none";
    core = createDockerSandbox({
      workspaceRoot: options.workspaceRoot,
      image,
      network,
      ...(options.dockerBin || env.XRK_SANDBOX_DOCKER_BIN
        ? {
            dockerBin:
              options.dockerBin?.trim() || String(env.XRK_SANDBOX_DOCKER_BIN).trim(),
          }
        : {}),
      ...(options.dockerExtraRunArgs
        ? { extraRunArgs: options.dockerExtraRunArgs }
        : {}),
      inner: deny,
    });
  } else if (backend === "bwrap") {
    core = createBubblewrapSandbox({
      workspaceRoot: options.workspaceRoot,
      ...(options.bwrapBin || env.XRK_SANDBOX_BWRAP_BIN
        ? {
            bwrapBin:
              options.bwrapBin?.trim() || String(env.XRK_SANDBOX_BWRAP_BIN).trim(),
          }
        : {}),
      ...(options.bwrapExtraArgs ? { extraArgs: options.bwrapExtraArgs } : {}),
      inner: deny,
    });
  } else if (backend === "windows") {
    const helper = options.windowsHelper?.trim() ?? resolveWindowsSandboxHelper(env);
    if (!helper) {
      // Fail closed: no helper runtime means no isolation, so say so loudly.
      throw new SandboxBackendError(
        "windows sandbox requires XRK_SANDBOX_WINDOWS_HELPER (Codex-style helper binary)",
        "SANDBOX_UNAVAILABLE",
      );
    }
    const modeRaw = options.windowsMode ?? env.XRK_SANDBOX_WINDOWS_MODE;
    if (modeRaw !== undefined && !isWindowsSandboxMode(modeRaw)) {
      throw new SandboxBackendError(
        `unknown windows sandbox mode: ${String(modeRaw)}`,
        "SANDBOX_CONFIG",
      );
    }
    const networkRaw = String(
      options.windowsNetwork ?? env.XRK_SANDBOX_WINDOWS_NETWORK ?? "none",
    )
      .trim()
      .toLowerCase();
    core = createWindowsSandbox({
      workspaceRoot: options.workspaceRoot,
      helper,
      ...(modeRaw !== undefined ? { mode: modeRaw } : {}),
      networkAccess: networkRaw === "bridge" || networkRaw === "on",
      ...(options.windowsExtraArgs ? { extraArgs: options.windowsExtraArgs } : {}),
      inner: deny,
    });
  }

  if (options.remoteExecution) {
    return core;
  }
  // Docker / windows already jail cwd inside the Provider; bwrap binds the
  // host root. Still wrap with WorkspaceSandbox for host-path callers that
  // only go through wrapArgv without provider path math.
  if (backend === "docker" || backend === "windows") {
    return core;
  }
  return createWorkspaceSandbox({
    root: options.workspaceRoot,
    inner: core,
  });
}

export function resolveSandboxBackendKind(
  env: NodeJS.ProcessEnv = process.env,
): SandboxBackendKind {
  return backendFromEnv(env);
}
