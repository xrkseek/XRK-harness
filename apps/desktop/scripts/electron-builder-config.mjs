/**
 * electron-builder configuration factory (ADR-0008 · first-wave).
 * Pattern learned from deepseek-harness apps/desktop/scripts/electron-builder-config.mjs:
 * unsigned Windows via env · signing when credentials present · publish never at build · feed URL separate.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {NodeJS.Platform} hostPlatform
 * @param {string} hostArch
 */
export function createElectronBuilderConfig(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  const targetPlatform = env.XRK_DESKTOP_TARGET_PLATFORM ?? hostPlatform;
  const targetArch = env.XRK_DESKTOP_TARGET_ARCH ?? hostArch;
  const explicit = env.XRK_DESKTOP_TARGET?.trim();
  const targetName =
    explicit ||
    (targetPlatform === "win32" || targetPlatform === "win"
      ? `win-${targetArch}`
      : targetPlatform === "darwin" || targetPlatform === "mac"
        ? `mac-${targetArch}`
        : `${targetPlatform}-${targetArch}`);

  if (targetName !== "win-x64" && targetName !== "mac-arm64") {
    throw new Error(
      `xrk desktop: electron-builder first wave is win-x64 | mac-arm64 (got ${targetName})`,
    );
  }

  const unsignedRaw = env.XRK_DESKTOP_UNSIGNED?.trim();
  if (unsignedRaw !== undefined && unsignedRaw !== "" && unsignedRaw !== "0" && unsignedRaw !== "1") {
    throw new Error("xrk desktop: XRK_DESKTOP_UNSIGNED must be 0 or 1");
  }
  const unsigned = unsignedRaw === "1";
  if (unsigned && targetName !== "win-x64") {
    throw new Error("xrk desktop: unsigned packaging is Windows-only");
  }

  const buildRoot = join(APP_ROOT, ".desktop-build", "targets", targetName);
  const artifacts = unsigned
    ? join(buildRoot, "unsigned-artifacts")
    : join(buildRoot, "artifacts");
  mkdirSync(artifacts, { recursive: true });

  const winCer = env.XRK_DESKTOP_WINDOWS_CER_FILE?.trim();
  const forceWinSign = !unsigned && Boolean(winCer);
  const macIdentity = env.XRK_DESKTOP_MACOS_IDENTITY?.trim();

  const updateOrigin =
    (env.XRK_DESKTOP_AUTO_UPDATE_ENV?.trim() || "test") === "production"
      ? env.XRK_DESKTOP_UPDATE_ORIGIN?.trim()
      : env.XRK_DESKTOP_UPDATE_TEST_ORIGIN?.trim();
  const updateUrl =
    updateOrigin && updateOrigin.length > 0
      ? `${updateOrigin.replace(/\/+$/u, "")}/desktop/${targetName}`
      : undefined;

  const webRoot =
    env.XRK_DESKTOP_WEB_ROOT?.trim() ||
    join(APP_ROOT, "..", "web", "dist");
  const hostDist = join(APP_ROOT, "..", "desktop-host", "dist");

  return {
    appId: "com.xrkseek.harness",
    productName: "XRK Harness",
    artifactName: "xrk-harness-${version}-${os}-${arch}.${ext}",
    directories: { output: artifacts },
    asar: true,
    files: [
      "dist/**/*",
      "package.json",
      {
        from: hostDist,
        to: "desktop-host",
        filter: ["**/*"],
      },
      {
        from: webRoot,
        to: "web",
        filter: ["**/*"],
      },
    ],
    extraResources: [
      {
        from: join(buildRoot, "runtime"),
        to: "runtime",
        filter: ["**/*"],
      },
    ],
    afterPack: async (context) => {
      if (!updateUrl) return;
      const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
      const yml = [
        "provider: generic",
        `url: ${updateUrl}`,
        "channel: nightly",
        "updaterCacheDirName: xrk-harness-updater",
        "",
      ].join("\n");
      writeFileSync(join(resourcesDir, "app-update.yml"), yml, "utf8");
    },
    mac: {
      category: "public.app-category.developer-tools",
      hardenedRuntime: true,
      identity: macIdentity || null,
      forceCodeSigning: Boolean(macIdentity),
      notarize: Boolean(
        macIdentity &&
          env.XRK_DESKTOP_MACOS_APPLE_ID?.trim() &&
          env.XRK_DESKTOP_MACOS_APPLE_ID_PASSWORD?.trim() &&
          env.XRK_DESKTOP_MACOS_TEAM_ID?.trim(),
      ),
      target: ["dmg", "zip"],
    },
    win: {
      forceCodeSigning: forceWinSign,
      target: ["nsis"],
      ...(forceWinSign
        ? {
            signtoolOptions: {
              certificateFile: winCer,
              signingHashAlgorithms: ["sha256"],
            },
          }
        : {}),
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      differentialPackage: true,
      installerLanguages: ["en_US", "zh_CN"],
    },
    detectUpdateChannel: false,
    publish: updateUrl
      ? [{ provider: "generic", url: updateUrl, channel: "nightly" }]
      : null,
  };
}
