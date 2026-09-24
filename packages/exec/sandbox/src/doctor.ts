/**
 * Honest sandbox helper / binary probes for `xrkh doctor` and Host status.
 * Never throws — surfaces availability instead of mid-execution surprises.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  resolveSandboxBackendKind,
  type SandboxBackendKind,
} from "./resolve.js";
import {
  resolveWindowsSandboxHelper,
  windowsSandboxCapability,
} from "./windows.js";

export interface SandboxProbeCheck {
  readonly name: string;
  /** False when the configured backend cannot run. */
  readonly ok: boolean;
  readonly detail: string;
}

export interface SandboxProbeResult {
  readonly backend: SandboxBackendKind;
  readonly checks: readonly SandboxProbeCheck[];
  /** True when every check is ok (workspace backend always ok). */
  readonly ok: boolean;
}

function commandOnPath(bin: string, args: readonly string[]): {
  readonly ok: boolean;
  readonly detail: string;
} {
  const result = spawnSync(bin, [...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) {
    return { ok: false, detail: `${bin} not runnable (${result.error.message})` };
  }
  if (result.status !== 0) {
    const err = String(result.stderr ?? result.stdout ?? "").trim();
    return {
      ok: false,
      detail: err
        ? `${bin} exited ${result.status}: ${err.slice(0, 160)}`
        : `${bin} exited ${result.status}`,
    };
  }
  const out = String(result.stdout ?? "").trim().split(/\r?\n/)[0] ?? "";
  return { ok: true, detail: out || `${bin} ok` };
}

function resolveBin(
  preferred: string | undefined,
  fallback: string,
): string {
  const raw = preferred?.trim();
  return raw || fallback;
}

/**
 * Probe the active sandbox backend (from env / override) and its helper.
 * Informational for `workspace`; fail-closed readiness for docker / bwrap / windows.
 */
export function probeSandboxEnvironment(
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly backend?: SandboxBackendKind;
    readonly workspaceRoot?: string;
    readonly platform?: NodeJS.Platform;
  } = {},
): SandboxProbeResult {
  const env = options.env ?? process.env;
  const backend = options.backend ?? resolveSandboxBackendKind(env);
  const checks: SandboxProbeCheck[] = [];

  checks.push({
    name: "sandbox-backend",
    ok: true,
    detail: `XRK_SANDBOX_BACKEND=${backend}${
      String(env.XRK_SANDBOX_BACKEND ?? "").trim()
        ? " (env)"
        : " (default)"
    }`,
  });

  if (backend === "workspace") {
    checks.push({
      name: "sandbox-helper",
      ok: true,
      detail: "workspace jail — no external helper required",
    });
  } else if (backend === "windows") {
    const fromEnv = resolveWindowsSandboxHelper(env);
    const cap = windowsSandboxCapability({
      ...(fromEnv ? { helper: fromEnv } : {}),
      env,
      platform: options.platform ?? process.platform,
    });
    checks.push({
      name: "sandbox-helper",
      ok: cap.available,
      detail: cap.available
        ? `windows helper ready (${cap.helper})`
        : cap.reason ?? "windows helper unavailable",
    });
  } else if (backend === "docker") {
    const dockerBin = resolveBin(
      env.XRK_SANDBOX_DOCKER_BIN,
      process.platform === "win32" ? "docker.exe" : "docker",
    );
    const image = String(env.XRK_SANDBOX_DOCKER_IMAGE ?? "").trim();
    const ver = commandOnPath(dockerBin, ["version", "--format", "{{.Server.Version}}"]);
    // Fall back to plain `docker version` when Go template unsupported.
    const probe = ver.ok
      ? ver
      : commandOnPath(dockerBin, ["version"]);
    checks.push({
      name: "sandbox-helper",
      ok: probe.ok && Boolean(image),
      detail: !image
        ? `${dockerBin} present=${probe.ok}; XRK_SANDBOX_DOCKER_IMAGE unset (required)`
        : probe.ok
          ? `${dockerBin} ${probe.detail}; image=${image}`
          : `${probe.detail}; image=${image}`,
    });
  } else if (backend === "bwrap") {
    const bwrapBin = resolveBin(env.XRK_SANDBOX_BWRAP_BIN, "bwrap");
    const looksLikePath =
      path.isAbsolute(bwrapBin) ||
      bwrapBin.includes("/") ||
      bwrapBin.includes("\\");
    if (looksLikePath && !existsSync(bwrapBin)) {
      checks.push({
        name: "sandbox-helper",
        ok: false,
        detail: `bwrap helper not found: ${bwrapBin}`,
      });
    } else {
      const probe = commandOnPath(bwrapBin, ["--help"]);
      checks.push({
        name: "sandbox-helper",
        ok: probe.ok,
        detail: probe.ok
          ? `${bwrapBin} available`
          : probe.detail,
      });
    }
  }

  return {
    backend,
    checks,
    ok: checks.every((c) => c.ok),
  };
}
