/**
 * electron-builder configuration factory (ADR-0008).
 * Pattern learned from deepseek-harness apps/desktop/scripts/electron-builder-config.mjs:
 * unsigned Windows via env · token signing when credentials present · publish never at build · feed URL separate.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const requireFromApp = createRequire(join(APP_ROOT, "package.json"));

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
  const {
    isDesktopUnsignedRequested,
    resolveDesktopMacOSSigningEnvironment,
    resolveDesktopWindowsSigningEnvironment,
  } = requireFromApp("./dist/desktop-signing-environment.js");
  const {
    assertDesktopWindowsSigningReady,
    createDesktopWindowsTokenSigner,
    resolveDesktopWindowsUpdatePublisher,
  } = requireFromApp("./dist/windows-sign.js");

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

  if (
    targetName !== "win-x64" &&
    targetName !== "mac-arm64" &&
    targetName !== "mac-x64"
  ) {
    throw new Error(
      `xrk desktop: electron-builder release targets are win-x64 | mac-arm64 | mac-x64 (got ${targetName})`,
    );
  }

  const unsigned = isDesktopUnsignedRequested(env);
  if (unsigned && targetName !== "win-x64") {
    throw new Error("xrk desktop: unsigned packaging is Windows-only");
  }

  const packagesWindows = targetName.startsWith("win-");
  const packagesMacOS = targetName.startsWith("mac-");

  const windowsSigning = packagesWindows && !unsigned
    ? resolveDesktopWindowsSigningEnvironment(env)
    : undefined;
  /** @type {((configuration: { path: string, hash: string, isNest: boolean }) => Promise<void>) | undefined} */
  let windowsSigner;
  /** @type {string | undefined} */
  let windowsPublisher;
  if (windowsSigning !== undefined) {
    assertDesktopWindowsSigningReady(windowsSigning);
    windowsSigner = createDesktopWindowsTokenSigner(windowsSigning);
    windowsPublisher = resolveDesktopWindowsUpdatePublisher(
      windowsSigning.certificateFile,
    );
  }

  const macOSSigning = packagesMacOS
    ? resolveDesktopMacOSSigningEnvironment(env)
    : undefined;

  const buildRoot = join(APP_ROOT, ".desktop-build", "targets", targetName);
  const artifacts = unsigned
    ? join(buildRoot, "unsigned-artifacts")
    : join(buildRoot, "artifacts");
  mkdirSync(artifacts, { recursive: true });

  const updateOrigin =
    (env.XRK_DESKTOP_AUTO_UPDATE_ENV?.trim() || "test") === "production"
      ? env.XRK_DESKTOP_UPDATE_ORIGIN?.trim()
      : env.XRK_DESKTOP_UPDATE_TEST_ORIGIN?.trim();
  // Unsigned Windows builds must not embed a feed (matches dsh: update disabled when UNSIGNED=1).
  const updateUrl =
    unsigned || !updateOrigin || updateOrigin.length === 0
      ? undefined
      : `${updateOrigin.replace(/\/+$/u, "")}/desktop/${targetName}`;

  const webRoot =
    env.XRK_DESKTOP_WEB_ROOT?.trim() ||
    join(APP_ROOT, "..", "web", "dist");
  const hostDist = join(APP_ROOT, "..", "desktop-host", "dist");

  return {
    appId: "com.xrkseek.harness",
    productName: "XRK Harness",
    // Unsigned builds carry a suffix so a shared file can never pass for a release artifact.
    artifactName: `xrk-harness-\${version}-\${os}-\${arch}${unsigned ? "-unsigned" : ""}.\${ext}`,
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
      identity: macOSSigning?.signingIdentity ?? null,
      forceCodeSigning: Boolean(macOSSigning?.signingIdentity),
      notarize: Boolean(
        macOSSigning &&
          macOSSigning.appleId &&
          macOSSigning.appleIdPassword &&
          macOSSigning.teamId,
      ),
      target: ["dmg", "zip"],
    },
    win: {
      forceCodeSigning: windowsSigner !== undefined,
      // Unsigned: skip Authenticode entirely (electron-builder otherwise still invokes signtool).
      signAndEditExecutable: windowsSigner !== undefined,
      target: ["nsis"],
      ...(windowsSigner !== undefined
        ? {
            signtoolOptions: {
              sign: windowsSigner,
              publisherName: windowsPublisher,
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
