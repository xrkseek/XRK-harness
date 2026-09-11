/**
 * Immutable Desktop release identity (shell · bundled runtime · seed share one version).
 * ADR-0008: update channel ships one whole Desktop release — no split tracks.
 */

import { DESKTOP_HOST_PROTOCOL_VERSION } from "./host-protocol.js";
import {
  DESKTOP_BUNDLED_NODE_VERSION,
  DESKTOP_BUNDLED_PNPM_VERSION,
} from "./prepare-runtime.js";

/** Release facts embedded in seed / runtime and bound to the Electron shell. */
export interface DesktopRelease {
  readonly schemaVersion: 1;
  /** Exact Desktop release number (shell · Host · Web dist · seed). */
  readonly version: string;
  readonly hostProtocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION;
  /** Bundled upstream Node (prepare-runtime). */
  readonly nodeVersion: string;
  /** Bundled pnpm (prepare-runtime). */
  readonly pnpmVersion: string;
}

/** Parts that must share one Desktop release number for an update unit. */
export const DESKTOP_UPDATE_UNIT_PARTS = [
  "shell",
  "runtime",
  "seed",
] as const;

export type DesktopUpdateUnitPart = (typeof DESKTOP_UPDATE_UNIT_PARTS)[number];

/**
 * MVP update delivery: download/install one whole Desktop artifact
 * (shell + runtime + seed bound by {@link DesktopRelease.version}).
 * Blockmap differential reuse and COS/upload pipelines are phase 2.
 */
export const DESKTOP_UPDATE_MVP_MODE = "full-package" as const;

export type DesktopUpdateMvpMode = typeof DESKTOP_UPDATE_MVP_MODE;

/** Explicitly deferred relative to MVP full-package updates. */
export const DESKTOP_UPDATE_PHASE2_DEFERRED = [
  "blockmap-differential-reuse",
  "artifact-upload-pipeline",
] as const;

export type DesktopUpdatePhase2Deferred =
  (typeof DESKTOP_UPDATE_PHASE2_DEFERRED)[number];

/** MVP always returns full-package; phase-2 modes are not selectable yet. */
export function resolveDesktopUpdateMvpMode(): DesktopUpdateMvpMode {
  return DESKTOP_UPDATE_MVP_MODE;
}

/** Whether a capability id is deferred to Desktop update phase 2. */
export function isDesktopUpdatePhase2Deferred(id: string): boolean {
  return (DESKTOP_UPDATE_PHASE2_DEFERRED as readonly string[]).includes(id);
}

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertVersionLabel(label: string, version: string): void {
  if (!VERSION_PATTERN.test(version) || version === "latest") {
    throw new Error(
      `xrk desktop release: invalid ${label} version ${JSON.stringify(version)}`,
    );
  }
}

/** Validate release metadata from seed / packaged resources. */
export function parseDesktopRelease(value: unknown): DesktopRelease {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.version !== "string" ||
    value.hostProtocolVersion !== DESKTOP_HOST_PROTOCOL_VERSION ||
    typeof value.nodeVersion !== "string" ||
    typeof value.pnpmVersion !== "string"
  ) {
    throw new Error("xrk desktop release: invalid desktop release metadata");
  }
  assertVersionLabel("desktop", value.version);
  assertVersionLabel("node", value.nodeVersion);
  assertVersionLabel("pnpm", value.pnpmVersion);
  return {
    schemaVersion: 1,
    version: value.version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: value.nodeVersion,
    pnpmVersion: value.pnpmVersion,
  };
}

/**
 * Build release identity for the pinned bundled runtime defaults.
 * Callers still pass the Desktop shell / seed version.
 */
export function createDesktopRelease(options: {
  readonly version: string;
  readonly nodeVersion?: string;
  readonly pnpmVersion?: string;
}): DesktopRelease {
  return parseDesktopRelease({
    schemaVersion: 1,
    version: options.version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: options.nodeVersion ?? DESKTOP_BUNDLED_NODE_VERSION,
    pnpmVersion: options.pnpmVersion ?? DESKTOP_BUNDLED_PNPM_VERSION,
  });
}

/**
 * Assert shell · runtime · seed form one update unit (same Desktop version;
 * runtime node/pnpm match the release record).
 */
export function assertDesktopUpdateUnit(options: {
  readonly release: DesktopRelease;
  readonly shellVersion: string;
  readonly seedVersion: string;
  readonly runtimeNodeVersion: string;
  readonly runtimePnpmVersion: string;
}): void {
  const { release } = options;
  if (options.shellVersion !== release.version) {
    throw new Error(
      `xrk desktop update: shell ${options.shellVersion} does not match release ${release.version}`,
    );
  }
  if (options.seedVersion !== release.version) {
    throw new Error(
      `xrk desktop update: seed ${options.seedVersion} does not match release ${release.version}`,
    );
  }
  if (options.runtimeNodeVersion !== release.nodeVersion) {
    throw new Error(
      `xrk desktop update: runtime node ${options.runtimeNodeVersion} does not match release node ${release.nodeVersion}`,
    );
  }
  if (options.runtimePnpmVersion !== release.pnpmVersion) {
    throw new Error(
      `xrk desktop update: runtime pnpm ${options.runtimePnpmVersion} does not match release pnpm ${release.pnpmVersion}`,
    );
  }
}
