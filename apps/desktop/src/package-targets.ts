/**
 * Desktop electron-builder packaging targets (ADR-0008).
 * Release matrix (aligned with latest dsh): win-x64 · mac-arm64 · mac-x64.
 * Linux / win-arm64 remain deferred — do not ship.
 * Signing: env-gated (see desktop-signing-environment). Unsigned Windows via XRK_DESKTOP_UNSIGNED=1.
 */

import { scrubDesktopSigningEnvironment } from "./windows-sign.js";

/** Supported release target ids (scripts / CI may select only these). */
export type DesktopPackageTargetName = "win-x64" | "mac-arm64" | "mac-x64";

/** Targets explicitly deferred — must throw if selected for packaging. */
export type DesktopDeferredPackageTargetName =
  | "linux-x64"
  | "linux-arm64"
  | "win-arm64";

/** One supported target and its electron-builder CLI selectors. */
export interface DesktopPackageTarget {
  readonly name: DesktopPackageTargetName;
  readonly platform: "darwin" | "win32";
  readonly arch: "arm64" | "x64";
  readonly builderPlatform: "--mac" | "--win";
  readonly builderArch: "--arm64" | "--x64";
  /** electron-builder `target` list for this OS row. */
  readonly builderTargets: readonly string[];
}

const SUPPORTED: Record<DesktopPackageTargetName, DesktopPackageTarget> = {
  "win-x64": {
    name: "win-x64",
    platform: "win32",
    arch: "x64",
    builderPlatform: "--win",
    builderArch: "--x64",
    builderTargets: ["nsis"],
  },
  "mac-arm64": {
    name: "mac-arm64",
    platform: "darwin",
    arch: "arm64",
    builderPlatform: "--mac",
    builderArch: "--arm64",
    builderTargets: ["dmg", "zip"],
  },
  "mac-x64": {
    name: "mac-x64",
    platform: "darwin",
    arch: "x64",
    builderPlatform: "--mac",
    builderArch: "--x64",
    builderTargets: ["dmg", "zip"],
  },
};

const DEFERRED = new Set<string>(["linux-x64", "linux-arm64", "win-arm64"]);

/** Env prefix for Windows signing secrets (scrubbed from prep subprocesses). */
export const DESKTOP_WINDOWS_SIGNING_ENV_PREFIX = "XRK_DESKTOP_WINDOWS_" as const;

/** Upload credential env names scrubbed from packaging subprocesses. */
export const DESKTOP_UPLOAD_CREDENTIAL_ENV_NAMES = [
  "XRK_DESKTOP_UPLOAD_SECRET_ID",
  "XRK_DESKTOP_UPLOAD_SECRET_KEY",
  "XRK_DESKTOP_UPLOAD_TEST_SECRET_ID",
  "XRK_DESKTOP_UPLOAD_TEST_SECRET_KEY",
  "XRK_DESKTOP_UPLOAD_BUCKET",
  "XRK_DESKTOP_UPLOAD_TEST_BUCKET",
] as const;

/** electron-builder product identity (apps/desktop/electron-builder.config.mjs). */
export const DESKTOP_BUILDER_CONFIG = {
  appId: "com.xrkseek.harness",
  productName: "XRK Harness",
  artifactName: "xrk-harness-${version}-${os}-${arch}.${ext}",
  configFile: "electron-builder.config.mjs",
  asar: true,
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    differentialPackage: true,
  },
  mac: {
    category: "public.app-category.developer-tools",
    hardenedRuntime: true,
  },
} as const;

/** Ordered supported release targets. */
export function listDesktopPackageTargets(): readonly DesktopPackageTarget[] {
  return [SUPPORTED["win-x64"], SUPPORTED["mac-arm64"], SUPPORTED["mac-x64"]];
}

/**
 * Resolve one packaging target. Deferred / unknown names throw.
 * Host compatibility is {@link assertDesktopPackageHostCompatible}.
 */
export function resolveDesktopPackageTarget(
  name: string,
): DesktopPackageTarget {
  if (DEFERRED.has(name)) {
    throw new Error(
      `xrk desktop: packaging target ${JSON.stringify(name)} is deferred (supported: win-x64, mac-arm64, mac-x64)`,
    );
  }
  const target = SUPPORTED[name as DesktopPackageTargetName];
  if (target === undefined) {
    throw new Error(
      `xrk desktop: unknown packaging target ${JSON.stringify(name)} (supported: win-x64, mac-arm64, mac-x64)`,
    );
  }
  return target;
}

/** Whether a target id is in the supported release matrix. */
export function isDesktopFirstWavePackageTarget(
  name: string,
): name is DesktopPackageTargetName {
  return Object.hasOwn(SUPPORTED, name);
}

/**
 * Reject cross-OS / wrong-arch hosts before a packaging script runs.
 * mac-x64 may build on Apple Silicon (Rosetta) or Intel Mac — matches dsh.
 */
export function assertDesktopPackageHostCompatible(
  target: DesktopPackageTarget,
  hostPlatform: NodeJS.Platform,
  hostArch: string,
): void {
  if (target.platform === "win32") {
    if (hostPlatform !== "win32" || hostArch !== "x64") {
      throw new Error(
        `xrk desktop: ${target.name} requires a Windows x64 host (found ${hostPlatform}/${hostArch})`,
      );
    }
    return;
  }
  if (hostPlatform !== "darwin") {
    throw new Error(
      `xrk desktop: ${target.name} requires a macOS build host (found ${hostPlatform}/${hostArch})`,
    );
  }
  if (target.name === "mac-arm64" && hostArch !== "arm64") {
    throw new Error(
      `xrk desktop: mac-arm64 requires Apple Silicon (found ${hostPlatform}/${hostArch})`,
    );
  }
  if (target.name === "mac-x64" && hostArch !== "arm64" && hostArch !== "x64") {
    throw new Error(
      `xrk desktop: mac-x64 requires an Intel Mac or Apple Silicon with Rosetta (found ${hostPlatform}/${hostArch})`,
    );
  }
}

/**
 * electron-builder argv for one supported target.
 * Always disables publish here; upload pipeline is a separate validated step.
 */
export function desktopElectronBuilderArguments(
  target: DesktopPackageTarget,
  options: { readonly directory?: boolean } = {},
): readonly string[] {
  const args = [
    "exec",
    "electron-builder",
    "--config",
    DESKTOP_BUILDER_CONFIG.configFile,
    target.builderPlatform,
    target.builderArch,
    "--publish",
    "never",
  ];
  if (options.directory === true) args.push("--dir");
  return args;
}

/** Strip Windows signing env from package-prep subprocess environments. */
export function withoutDesktopWindowsSigningEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return scrubDesktopSigningEnvironment(environment);
}

/** Strip upload-only credentials from packaging subprocess environments. */
export function withoutDesktopUploadCredentials(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const blocked = new Set<string>(DESKTOP_UPLOAD_CREDENTIAL_ENV_NAMES);
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !blocked.has(name)),
  );
}

/**
 * Environment for the electron-builder subprocess (dsh `desktopElectronBuilderEnvironment`).
 * Unsigned Windows: strip signing + CSC_* and disable identity auto-discovery.
 */
export function desktopElectronBuilderEnvironment(
  environment: NodeJS.ProcessEnv,
  unsigned: boolean,
): NodeJS.ProcessEnv {
  const selected: NodeJS.ProcessEnv = {
    ...environment,
    XRK_DESKTOP_UNSIGNED: unsigned ? "1" : "0",
  };
  // Bundled NSIS decoder cannot extract 7-Zip ARM64-filtered entries.
  if (
    environment.XRK_DESKTOP_TARGET_PLATFORM === "win32" ||
    environment.XRK_DESKTOP_TARGET?.startsWith("win-") === true
  ) {
    selected.ELECTRON_BUILDER_7Z_FILTER = "BCJ";
  }
  if (!unsigned) return selected;
  return {
    ...Object.fromEntries(
      Object.entries(withoutDesktopWindowsSigningEnvironment(selected)).filter(
        ([name]) => !/^(?:WIN_)?CSC_/iu.test(name),
      ),
    ),
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
    XRK_DESKTOP_UNSIGNED: "1",
  };
}
