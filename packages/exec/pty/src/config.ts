import { resolvePtyShell } from "./resolve-shell.js";

export interface PtyBackendConfig {
  readonly backendType: string;
  readonly shellPath: string;
  readonly shellArgs: readonly string[];
  readonly rows: number;
  readonly cols: number;
  readonly scrollbackLines: number;
  readonly scrollbackMaxBytes: number;
  readonly maxReadBytes: number;
  readonly pollIntervalMs: number;
  readonly exactProbeAfterMs: number;
  readonly idleSilenceMs: number;
  readonly handoffGraceMs: number;
  readonly timeoutMs: number;
  readonly disposeGraceMs: number;
}

/**
 * Assert every numeric config field is a positive safe integer and bounds compose
 * (CV DSH terminal-bash `validateConfig`).
 */
export function validatePtyBackendConfig(
  config: PtyBackendConfig,
): asserts config is PtyBackendConfig {
  if (config.backendType.length === 0) {
    throw new Error("pty: backendType must be non-empty");
  }
  if (config.shellPath.length === 0) {
    throw new Error("pty: shellPath must be non-empty");
  }
  for (const [name, value] of Object.entries(config)) {
    if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`pty: ${name} must be a positive safe integer`);
    }
  }
  if (config.maxReadBytes > config.scrollbackMaxBytes) {
    throw new Error("pty: maxReadBytes must not exceed scrollbackMaxBytes");
  }
  if (config.handoffGraceMs < config.pollIntervalMs) {
    throw new Error(
      "pty: handoffGraceMs must be at least pollIntervalMs so one readiness poll runs inside the grace window",
    );
  }
}

export function defaultPtyBackendConfig(
  overrides: Partial<PtyBackendConfig> = {},
): PtyBackendConfig {
  const shell = resolvePtyShell();
  const resolved: PtyBackendConfig = {
    backendType: "shell",
    shellPath: shell.shellPath,
    shellArgs: [...shell.shellArgs],
    rows: 40,
    cols: 160,
    scrollbackLines: 10_000,
    scrollbackMaxBytes: 4 * 1024 * 1024,
    maxReadBytes: 256 * 1024,
    pollIntervalMs: 50,
    exactProbeAfterMs: 150,
    idleSilenceMs: 3_000,
    handoffGraceMs: 500,
    timeoutMs: 30_000,
    disposeGraceMs: 3_000,
    ...overrides,
  };
  validatePtyBackendConfig(resolved);
  return resolved;
}
