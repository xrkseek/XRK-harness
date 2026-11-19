/**
 * Desktop auto-update feed (ADR-0008).
 * Product default: GitHub Releases (`provider: github`) — same source-of-truth
 * model as the phone App. Optional `XRK_DESKTOP_UPDATE_*_ORIGIN` still enables a
 * generic feed for local/dev mirrors only.
 */

import type { DesktopPackageTargetName } from "./package-targets.js";
import {
  DESKTOP_UPDATE_GITHUB_OWNER,
  DESKTOP_UPDATE_GITHUB_REPO,
  DESKTOP_UPDATE_METADATA_CHANNEL,
  renderDesktopGithubAppUpdateYml,
} from "./desktop-update-mirrors.js";

export const DESKTOP_AUTO_UPDATE_ENV = "XRK_DESKTOP_AUTO_UPDATE_ENV" as const;

/** Opt-in: embed update feed on unsigned Windows test builds. */
export const DESKTOP_UNSIGNED_UPDATE_ENV = "XRK_DESKTOP_UNSIGNED_UPDATE" as const;

export function isDesktopUnsignedUpdateRequested(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[DESKTOP_UNSIGNED_UPDATE_ENV]?.trim() === "1";
}

export type DesktopAutoUpdateChannel = "test" | "production";

export type DesktopAutoUpdateProvider = "github" | "generic";

export interface DesktopAutoUpdateConfig {
  readonly channel: DesktopAutoUpdateChannel;
  readonly metadataChannel: typeof DESKTOP_UPDATE_METADATA_CHANNEL;
  readonly provider: DesktopAutoUpdateProvider;
  /** Set when `provider: generic` (local/dev origin). */
  readonly publicUrl?: string;
  /** Set when `provider: github`. */
  readonly owner?: string;
  readonly repo?: string;
}

/** Private object-store destination for one channel (legacy COS-shaped env). */
export interface DesktopUploadConfig extends DesktopAutoUpdateConfig {
  readonly environment: DesktopAutoUpdateChannel;
  readonly target: DesktopPackageTargetName;
  readonly origin: string;
  readonly keyPrefix: string;
  readonly binaryKeyPrefix: string;
  readonly bucket: string;
  readonly secretIdEnvName: string;
  readonly secretKeyEnvName: string;
  readonly publicUrl: string;
  readonly provider: "generic";
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

/** Product default: GitHub Releases for xrkseek/XRK-harness. */
export function resolveDesktopGithubAutoUpdateConfig(
  env: NodeJS.ProcessEnv = process.env,
): DesktopAutoUpdateConfig {
  return {
    channel: resolveDesktopAutoUpdateChannel(env),
    metadataChannel: DESKTOP_UPDATE_METADATA_CHANNEL,
    provider: "github",
    owner: DESKTOP_UPDATE_GITHUB_OWNER,
    repo: DESKTOP_UPDATE_GITHUB_REPO,
  };
}

/**
 * Resolve update feed for packaging.
 * - Default / unsigned+flag without origin → GitHub provider
 * - `XRK_DESKTOP_UPDATE_*_ORIGIN` set → generic (local/dev only)
 */
export function resolveDesktopAutoUpdateConfig(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): DesktopAutoUpdateConfig | undefined {
  resolveSupportedUpdateTarget(platform, arch);
  const channel = resolveDesktopAutoUpdateChannel(env);
  const spec = CHANNELS[channel];
  const origin = trimEnv(env, spec.originEnv);
  if (origin !== undefined) {
    const target = resolveSupportedUpdateTarget(platform, arch);
    const base = origin.replace(/\/+$/u, "");
    return {
      channel,
      publicUrl: `${base}/desktop/${target}`,
      metadataChannel: DESKTOP_UPDATE_METADATA_CHANNEL,
      provider: "generic",
    };
  }
  // Product default: GitHub Releases (phone-aligned). Packaging may still omit
  // writing app-update.yml for unsigned builds without UNSIGNED_UPDATE=1.
  return resolveDesktopGithubAutoUpdateConfig(env);
}

/**
 * Resolve public feed + private upload destination for one supported target.
 * Legacy COS/generic upload path — not used for product GitHub Releases.
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
    metadataChannel: DESKTOP_UPDATE_METADATA_CHANNEL,
    provider: "generic",
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
  | readonly [
      | {
          readonly provider: "github";
          readonly owner: string;
          readonly repo: string;
          readonly channel: string;
        }
      | {
          readonly provider: "generic";
          readonly url: string;
          readonly channel: string;
        },
    ] {
  if (update === undefined) return null;
  if (update.provider === "github") {
    return [
      {
        provider: "github",
        owner: update.owner ?? DESKTOP_UPDATE_GITHUB_OWNER,
        repo: update.repo ?? DESKTOP_UPDATE_GITHUB_REPO,
        channel: update.metadataChannel,
      },
    ];
  }
  if (!update.publicUrl) return null;
  return [
    {
      provider: "generic",
      url: update.publicUrl,
      channel: update.metadataChannel,
    },
  ];
}

/** YAML body for `app-update.yml`. */
export function renderDesktopAppUpdateYml(
  update: DesktopAutoUpdateConfig,
): string {
  if (update.provider === "github") {
    return renderDesktopGithubAppUpdateYml({
      ...(update.owner !== undefined ? { owner: update.owner } : {}),
      ...(update.repo !== undefined ? { repo: update.repo } : {}),
      ...(update.metadataChannel !== undefined
        ? { channel: update.metadataChannel }
        : {}),
    });
  }
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
  _version: string,
  platform: "darwin" | "win32",
): string {
  // channel=nightly → nightly.yml / nightly-mac.yml.
  return platform === "darwin" ? "nightly-mac.yml" : "nightly.yml";
}

/** Completion record written next to artifacts after a successful package run. */
export function desktopPackageCompleteFilename(
  target: DesktopPackageTargetName,
): string {
  return `package-complete-${target}.json`;
}
