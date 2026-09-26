/**
 * Desktop auto-update feed + upload destination (ADR-0008 · electron-updater generic).
 * Upload PUTs stay credential-gated; resolve here so packaging / CI share one SoT.
 */

import type { DesktopPackageTargetName } from "./package-targets.js";

export const DESKTOP_AUTO_UPDATE_ENV = "XRK_DESKTOP_AUTO_UPDATE_ENV" as const;

export type DesktopAutoUpdateChannel = "test" | "production";

export interface DesktopAutoUpdateConfig {
  readonly channel: DesktopAutoUpdateChannel;
  /** electron-updater generic `provider` URL (directory that hosts latest*.yml). */
  readonly publicUrl: string;
  readonly metadataChannel: "nightly";
}

/** Private object-store destination for one channel (COS-shaped env; transport is pluggable). */
export interface DesktopUploadConfig extends DesktopAutoUpdateConfig {
  readonly environment: DesktopAutoUpdateChannel;
  readonly target: DesktopPackageTargetName;
  readonly origin: string;
  /** Prefix for channel metadata YAML (`latest*.yml` / `nightly*.yml`). */
  readonly keyPrefix: string;
  /** Prefix for installer binaries + blockmaps. */
  readonly binaryKeyPrefix: string;
  readonly bucket: string;
  readonly secretIdEnvName: string;
  readonly secretKeyEnvName: string;
}

const CHANNELS: Record<
  DesktopAutoUpdateChannel,
  {
    readonly originEnv: string;
    readonly bucketEnv: string;
    readonly secretIdEnv: string;
    readonly secretKeyEnv: string;
  }
> = {
  test: {
    originEnv: "XRK_DESKTOP_UPDATE_TEST_ORIGIN",
    bucketEnv: "XRK_DESKTOP_UPLOAD_TEST_BUCKET",
    secretIdEnv: "XRK_DESKTOP_UPLOAD_TEST_SECRET_ID",
    secretKeyEnv: "XRK_DESKTOP_UPLOAD_TEST_SECRET_KEY",
  },
  production: {
    originEnv: "XRK_DESKTOP_UPDATE_ORIGIN",
    bucketEnv: "XRK_DESKTOP_UPLOAD_BUCKET",
    secretIdEnv: "XRK_DESKTOP_UPLOAD_SECRET_ID",
    secretKeyEnv: "XRK_DESKTOP_UPLOAD_SECRET_KEY",
  },
};

function trimEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = trimEnv(env, name);
  if (value === undefined) {
    throw new Error(`xrk desktop upload: ${name} must be set to a non-empty value`);
  }
  return value;
}

/** Resolve test|production; default test for local packaging. */
export function resolveDesktopAutoUpdateChannel(
  env: NodeJS.ProcessEnv = process.env,
): DesktopAutoUpdateChannel {
  const value = env[DESKTOP_AUTO_UPDATE_ENV]?.trim() || "test";
  if (value !== "test" && value !== "production") {
    throw new Error(
      `xrk desktop auto-update: ${DESKTOP_AUTO_UPDATE_ENV} must be "test" or "production"`,
    );
  }
  return value;
}

function resolveSupportedUpdateTarget(
  platform: NodeJS.Platform,
  arch: string,
): DesktopPackageTargetName {
  if (platform !== "darwin" && platform !== "win32") {
    throw new Error(
      `xrk desktop auto-update: unsupported platform ${platform}`,
    );
  }
  const os = platform === "darwin" ? "mac" : "win";
  const target = `${os}-${arch}`;
  if (target !== "win-x64" && target !== "mac-arm64" && target !== "mac-x64") {
    throw new Error(
      `xrk desktop auto-update: unsupported target ${target}`,
    );
  }
  return target;
}

/**
 * Resolve a generic update feed when an origin is configured.
 * Missing origin → undefined (packaged build still ships; check stays idle).
 */
export function resolveDesktopAutoUpdateConfig(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): DesktopAutoUpdateConfig | undefined {
  const target = resolveSupportedUpdateTarget(platform, arch);
  const channel = resolveDesktopAutoUpdateChannel(env);
  const spec = CHANNELS[channel];
  const origin = trimEnv(env, spec.originEnv);
  if (origin === undefined) return undefined;
  const base = origin.replace(/\/+$/u, "");
  return {
    channel,
    publicUrl: `${base}/desktop/${target}`,
    metadataChannel: "nightly",
  };
}

/**
 * Resolve public feed + private upload destination for one supported target.
 * Requires update origin + bucket (secrets are named here; values read at PUT time).
 */
export function resolveDesktopUploadConfig(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): DesktopUploadConfig {
  const target = resolveSupportedUpdateTarget(platform, arch);
  const channel = resolveDesktopAutoUpdateChannel(env);
  const spec = CHANNELS[channel];
  const origin = requiredEnv(env, spec.originEnv).replace(/\/+$/u, "");
  const keyPrefix = `desktop/${target}`;
  const binaryKeyPrefix = `desktop/bin/${target}`;
  return {
    channel,
    environment: channel,
    target,
    origin,
    keyPrefix,
    binaryKeyPrefix,
    publicUrl: `${origin}/${keyPrefix}`,
    metadataChannel: "nightly",
    bucket: requiredEnv(env, spec.bucketEnv),
    secretIdEnvName: spec.secretIdEnv,
    secretKeyEnvName: spec.secretKeyEnv,
  };
}

/** electron-builder `publish` block for a resolved feed (or null when disabled). */
export function desktopElectronBuilderPublish(
  update: DesktopAutoUpdateConfig | undefined,
):
  | null
  | readonly [{ readonly provider: "generic"; readonly url: string; readonly channel: string }] {
  if (update === undefined) return null;
  return [
    {
      provider: "generic",
      url: update.publicUrl,
      channel: update.metadataChannel,
    },
  ];
}

/** YAML body for `app-update.yml` (generic provider). */
export function renderDesktopAppUpdateYml(
  update: DesktopAutoUpdateConfig,
): string {
  return [
    "provider: generic",
    `url: ${update.publicUrl}`,
    `channel: ${update.metadataChannel}`,
    "updaterCacheDirName: xrk-harness-updater",
    "",
  ].join("\n");
}

/** Filename electron-builder writes for channel metadata. */
export function desktopUpdateMetadataFilename(
  version: string,
  platform: "darwin" | "win32",
): string {
  // electron-builder uses latest.yml on Windows and latest-mac.yml on macOS for the default channel;
  // our builds pin channel=nightly → nightly.yml / nightly-mac.yml.
  return platform === "darwin" ? "nightly-mac.yml" : "nightly.yml";
}

/** Completion record written next to artifacts after a successful package run. */
export function desktopPackageCompleteFilename(
  target: DesktopPackageTargetName,
): string {
  return `package-complete-${target}.json`;
}
