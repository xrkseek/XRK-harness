/**
 * Desktop auto-update feed environment (ADR-0008 · electron-updater generic provider).
 * Upload/COS pipelines stay phase 2; this resolves the public feed URL the shell checks.
 */

export const DESKTOP_AUTO_UPDATE_ENV = "XRK_DESKTOP_AUTO_UPDATE_ENV" as const;

export type DesktopAutoUpdateChannel = "test" | "production";

export interface DesktopAutoUpdateConfig {
  readonly channel: DesktopAutoUpdateChannel;
  /** electron-updater generic `provider` URL (directory that hosts latest*.yml). */
  readonly publicUrl: string;
  readonly metadataChannel: "nightly";
}

const CHANNELS: Record<
  DesktopAutoUpdateChannel,
  {
    readonly originEnv: string;
    readonly fixedOrigin?: string;
  }
> = {
  test: {
    originEnv: "XRK_DESKTOP_UPDATE_TEST_ORIGIN",
  },
  production: {
    originEnv: "XRK_DESKTOP_UPDATE_ORIGIN",
  },
};

function trimEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
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

/**
 * Resolve a generic update feed when an origin is configured.
 * Missing origin → undefined (packaged build still ships; check stays idle).
 */
export function resolveDesktopAutoUpdateConfig(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): DesktopAutoUpdateConfig | undefined {
  if (platform !== "darwin" && platform !== "win32") {
    throw new Error(
      `xrk desktop auto-update: unsupported platform ${platform}`,
    );
  }
  const os = platform === "darwin" ? "mac" : "win";
  const target = `${os}-${arch}`;
  if (target !== "win-x64" && target !== "mac-arm64") {
    throw new Error(
      `xrk desktop auto-update: first-wave target only (got ${target})`,
    );
  }
  const channel = resolveDesktopAutoUpdateChannel(env);
  const spec = CHANNELS[channel];
  const origin =
    trimEnv(env, spec.originEnv) ??
    (spec.fixedOrigin !== undefined ? spec.fixedOrigin : undefined);
  if (origin === undefined) return undefined;
  const base = origin.replace(/\/+$/u, "");
  return {
    channel,
    publicUrl: `${base}/desktop/${target}`,
    metadataChannel: "nightly",
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
