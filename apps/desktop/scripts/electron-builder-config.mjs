/**
 * electron-builder configuration factory (ADR-0008).
 * Pattern learned from deepseek-harness apps/desktop/scripts/electron-builder-config.mjs:
 * unsigned Windows via env · token signing when credentials present · publish never at build · feed URL separate.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

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
  const hostBundle = join(buildRoot, "host-bundle");

  // Brand plate: apps/web/public/logo-plate.png → apps/desktop/build/icon.{png,ico}
  const buildResources = join(APP_ROOT, "build");
  const iconPng = join(buildResources, "icon.png");
  const iconIco = join(buildResources, "icon.ico");

  // Prefer a local Electron dist when GitHub release downloads are unreachable.
  const localElectronDist = join(APP_ROOT, "node_modules", "electron", "dist");
  const localElectronMarker = join(
    localElectronDist,
    hostPlatform === "win32" ? "electron.exe" : "Electron",
  );
  const electronDist =
    env.XRK_DESKTOP_ELECTRON_DIST?.trim() ||
    (existsSync(localElectronMarker) ? localElectronDist : undefined);

  return {
    appId: "com.xrkseek.harness",
    productName: "XRK Harness",
    // Unsigned builds carry a suffix so a shared file can never pass for a release artifact.
    artifactName: `xrk-harness-\${version}-\${os}-\${arch}${unsigned ? "-unsigned" : ""}.\${ext}`,
    directories: { output: artifacts, buildResources },
    ...(electronDist ? { electronDist } : {}),
    // Prefer .ico on Windows (rcedit); PNG is the shared brand source / mac fallback.
    icon: packagesWindows ? iconIco : iconPng,
    asar: true,
    files: [
      "dist/**/*",
      "package.json",
      "build/icon.png",
      "build/icon.ico",
    ],
    extraResources: [
      {
        from: join(buildRoot, "runtime"),
        to: "runtime",
        filter: ["**/*"],
      },
      {
        from: webRoot,
        to: "web",
        filter: ["**/*"],
      },
    ],
    afterPack: async (context) => {
      const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
      // Host must live outside asar (Host Node cannot read asar). electron-builder's
      // FileSet always excludes `node_modules` from extraResources, so copy here.
      // prepare-host-bundle uses hoisted linker (real dirs, no SYMLINKD).
      if (!existsSync(join(hostBundle, "dist", "index.js"))) {
        throw new Error(
          `xrk desktop afterPack: missing host-bundle at ${hostBundle} ` +
            `(run pnpm --filter @xrkseek/harness-desktop prepare:host-bundle)`,
        );
      }
      const hostDest = join(resourcesDir, "host");
      rmSync(hostDest, { recursive: true, force: true });
      cpSync(hostBundle, hostDest, { recursive: true });
      const hostMarker = join(
        hostDest,
        "node_modules",
        "@xrkseek",
        "server-host",
        "package.json",
      );
      if (!existsSync(hostMarker)) {
        throw new Error(
          `xrk desktop afterPack: Host deps missing after copy (${hostMarker})`,
        );
      }
      if (!updateUrl) return;
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
      icon: iconPng,
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
      icon: iconIco,
      forceCodeSigning: windowsSigner !== undefined,
      // Keep rcedit (icon + version metadata). Unsigned skips Authenticode only.
      signAndEditExecutable: true,
      signExecutable: windowsSigner !== undefined,
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
      installerIcon: iconIco,
      uninstallerIcon: iconIco,
      installerHeaderIcon: iconIco,
    },
    detectUpdateChannel: false,
    publish: updateUrl
      ? [{ provider: "generic", url: updateUrl, channel: "nightly" }]
      : null,
  };
}
