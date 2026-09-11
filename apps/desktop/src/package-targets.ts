/**
 * Desktop electron-builder packaging targets (ADR-0008 draft).
 * First wave: win-x64 + mac-arm64. Linux (and mac-x64) deferred — do not ship.
 * Real code signing / notarize stay deferred (status); helpers only scrub secrets.
 */

/** First-wave release target ids (scripts / CI may select only these). */
export type DesktopPackageTargetName = "win-x64" | "mac-arm64";

/** Targets explicitly deferred — must throw if selected for packaging. */
export type DesktopDeferredPackageTargetName =
  | "linux-x64"
  | "linux-arm64"
  | "mac-x64"
  | "win-arm64";

/** One first-wave target and its electron-builder CLI selectors. */
export interface DesktopPackageTarget {
  readonly name: DesktopPackageTargetName;
  readonly platform: "darwin" | "win32";
  readonly arch: "arm64" | "x64";
  readonly builderPlatform: "--mac" | "--win";
  readonly builderArch: "--arm64" | "--x64";
  /** Planned electron-builder `target` list for this OS row. */
  readonly builderTargets: readonly string[];
}

const FIRST_WAVE: Record<DesktopPackageTargetName, DesktopPackageTarget> = {
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
};

const DEFERRED = new Set<string>([
  "linux-x64",
  "linux-arm64",
  "mac-x64",
  "win-arm64",
]);

/** Env prefix for future Windows signing secrets (never pass into prep subprocesses). */
export const DESKTOP_WINDOWS_SIGNING_ENV_PREFIX = "XRK_DESKTOP_WINDOWS_" as const;

/** Upload credential env names scrubbed from packaging subprocesses (phase-2 upload). */
export const DESKTOP_UPLOAD_CREDENTIAL_ENV_NAMES = [
  "XRK_DESKTOP_UPLOAD_SECRET_ID",
  "XRK_DESKTOP_UPLOAD_SECRET_KEY",
  "XRK_DESKTOP_UPLOAD_TEST_SECRET_ID",
  "XRK_DESKTOP_UPLOAD_TEST_SECRET_KEY",
] as const;

/** Planned product name / artifact pattern for a future electron-builder config. */
export const DESKTOP_BUILDER_DRAFT = {
  productName: "XRK Harness",
  artifactName: "xrk-harness-${version}-${os}-${arch}.${ext}",
  configFile: "electron-builder.config.mjs",
  asar: true,
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  mac: {
    category: "public.app-category.developer-tools",
    hardenedRuntime: true,
  },
} as const;

/** Ordered first-wave targets. */
export function listDesktopPackageTargets(): readonly DesktopPackageTarget[] {
  return [FIRST_WAVE["win-x64"], FIRST_WAVE["mac-arm64"]];
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
      `xrk desktop: packaging target ${JSON.stringify(name)} is deferred (first wave: win-x64, mac-arm64)`,
    );
  }
  const target = FIRST_WAVE[name as DesktopPackageTargetName];
  if (target === undefined) {
    throw new Error(
      `xrk desktop: unknown packaging target ${JSON.stringify(name)} (first wave: win-x64, mac-arm64)`,
    );
  }
  return target;
}

/** Whether a target id is in the first wave. */
export function isDesktopFirstWavePackageTarget(
  name: string,
): name is DesktopPackageTargetName {
  return Object.hasOwn(FIRST_WAVE, name);
}

/**
 * Reject cross-OS / wrong-arch hosts before a packaging script runs.
 * Does not perform signing — logic gate only.
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
      `xrk desktop: ${target.name} requires a macOS Apple Silicon host (found ${hostPlatform}/${hostArch})`,
    );
  }
  if (hostArch !== "arm64") {
    throw new Error(
      `xrk desktop: ${target.name} requires Apple Silicon (found ${hostPlatform}/${hostArch})`,
    );
  }
}

/**
 * Draft electron-builder argv for one first-wave target.
 * Always disables publish here; upload pipeline is phase 2.
 */
export function desktopElectronBuilderDraftArguments(
  target: DesktopPackageTarget,
  options: { readonly directory?: boolean } = {},
): readonly string[] {
  const args = [
    "exec",
    "electron-builder",
    "--config",
    DESKTOP_BUILDER_DRAFT.configFile,
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
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !name.startsWith(DESKTOP_WINDOWS_SIGNING_ENV_PREFIX),
    ),
  );
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
