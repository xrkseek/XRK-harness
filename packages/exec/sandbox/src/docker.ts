/**
 * Docker container sandbox Provider — rewrites argv to `docker run …`.
 * Same {@link SandboxService} Definition as workspace / deny-list backends.
 */
import path from "node:path";
import {
  createPermissiveSandbox,
  type SandboxService,
} from "./service.js";

export type DockerNetworkMode = "none" | "bridge";

export interface DockerSandboxOptions {
  /** Host workspace root (bind-mounted into the container). */
  readonly workspaceRoot: string;
  /** Image name (e.g. `node:22-bookworm`). */
  readonly image: string;
  /** Container mount path for the workspace. Default `/workspace`. */
  readonly containerWorkdir?: string;
  /** `docker run --network`. Default `none`. */
  readonly network?: DockerNetworkMode;
  /** Docker CLI binary. Default `docker`. */
  readonly dockerBin?: string;
  /** Extra args inserted before the image (e.g. `--memory=512m`). */
  readonly extraRunArgs?: readonly string[];
  /** Applied to the original argv before Docker wrapping. */
  readonly inner?: SandboxService;
}

export class SandboxBackendError extends Error {
  readonly code: string;

  constructor(message: string, code = "SANDBOX_BACKEND") {
    super(message);
    this.name = "SandboxBackendError";
    this.code = code;
  }
}

/** Map a Windows/Unix host path to a Docker Desktop-friendly mount source. */
export function hostPathForDockerMount(hostPath: string): string {
  const abs = path.resolve(hostPath);
  if (process.platform === "win32") {
    const m = /^([A-Za-z]):[\\/](.*)$/.exec(abs);
    if (!m) return abs.replace(/\\/g, "/");
    const rest = (m[2] ?? "").replace(/\\/g, "/");
    return `/${m[1]!.toLowerCase()}/${rest}`;
  }
  return abs;
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

function containerCwd(
  containerRoot: string,
  hostRoot: string,
  hostCwd: string,
): string {
  const rel = path.relative(hostRoot, hostCwd);
  if (!rel || rel === ".") return containerRoot;
  return `${containerRoot.replace(/\/$/, "")}/${rel.split(path.sep).join("/")}`;
}

/**
 * Wrap argv as a one-shot `docker run --rm` (Hermes-style container confine).
 * Tools keep using {@link SandboxService.confine}; only the Provider changes.
 */
export function createDockerSandbox(
  options: DockerSandboxOptions,
): SandboxService {
  const hostRoot = path.resolve(options.workspaceRoot);
  const image = options.image.trim();
  if (!image) {
    throw new SandboxBackendError(
      "docker sandbox requires a non-empty image",
      "SANDBOX_CONFIG",
    );
  }
  const containerRoot = options.containerWorkdir ?? "/workspace";
  const network = options.network ?? "none";
  const dockerBin = options.dockerBin?.trim() || "docker";
  const extra = options.extraRunArgs ?? [];
  const inner = options.inner ?? createPermissiveSandbox();
  const mountSrc = hostPathForDockerMount(hostRoot);

  const wrapConfined = (
    confined: readonly string[],
    cwd: string | undefined,
  ): readonly string[] => {
    const hostCwd = assertUnderRoot(hostRoot, cwd);
    const workdir = containerCwd(containerRoot, hostRoot, hostCwd);
    return [
      dockerBin,
      "run",
      "--rm",
      "-i",
      "--network",
      network,
      "-v",
      `${mountSrc}:${containerRoot}`,
      "-w",
      workdir,
      ...extra,
      image,
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
