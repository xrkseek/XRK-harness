/**
 * Per-target Desktop build directories under `apps/desktop/.desktop-build`
 * (ADR-0008 · prepare-runtime / later seed). Downloads are shared across targets.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveDesktopPackageTarget,
  type DesktopPackageTargetName,
} from "./package-targets.js";

/** Default app root when scripts resolve relative to this package. */
export function resolveDesktopAppRoot(
  fromUrl: string = import.meta.url,
): string {
  // src/*.ts → apps/desktop; dist/*.js → apps/desktop
  return path.resolve(path.dirname(fileURLToPath(fromUrl)), "..");
}

/** Mutable prep dirs for one supported target + shared download cache. */
export interface DesktopTargetBuildPaths {
  readonly target: DesktopPackageTargetName;
  readonly root: string;
  readonly runtime: string;
  readonly nodeExtract: string;
  readonly downloads: string;
  readonly packageSet: string;
  readonly seed: string;
  /** electron-builder output (signed or unsigned). */
  readonly artifacts: string;
  /** Unsigned-only artifact root when XRK_DESKTOP_UNSIGNED=1. */
  readonly unsignedArtifacts: string;
}

/**
 * Map host / env to a supported target id.
 * Prefers `XRK_DESKTOP_TARGET=win-x64|mac-arm64|mac-x64`; else platform+arch.
 */
export function resolveDesktopBuildTarget(
  env: NodeJS.ProcessEnv = process.env,
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: string = process.arch,
): DesktopPackageTargetName {
  const explicit = env.XRK_DESKTOP_TARGET?.trim();
  if (explicit) {
    return resolveDesktopPackageTarget(explicit).name;
  }
  const rawPlatform =
    env.XRK_DESKTOP_TARGET_PLATFORM?.trim() ||
    env.npm_config_platform ||
    hostPlatform;
  const rawArch =
    env.XRK_DESKTOP_TARGET_ARCH?.trim() || env.npm_config_arch || hostArch;
  const os =
    rawPlatform === "darwin" || rawPlatform === "mac"
      ? "mac"
      : rawPlatform === "win32" || rawPlatform === "win"
        ? "win"
        : rawPlatform === "linux"
          ? "linux"
          : rawPlatform;
  return resolveDesktopPackageTarget(`${os}-${rawArch}`).name;
}

/** Paths under `.desktop-build/targets/<target>/` plus shared downloads. */
export function desktopTargetBuildPaths(
  targetName: string,
  appRoot: string = resolveDesktopAppRoot(),
): DesktopTargetBuildPaths {
  const target = resolveDesktopPackageTarget(targetName).name;
  const buildRoot = path.join(path.resolve(appRoot), ".desktop-build");
  const root = path.join(buildRoot, "targets", target);
  return {
    target,
    root,
    runtime: path.join(root, "runtime"),
    nodeExtract: path.join(root, "node-extract"),
    downloads: path.join(buildRoot, "downloads"),
    packageSet: path.join(root, "package-set"),
    seed: path.join(root, "seed"),
    artifacts: path.join(root, "artifacts"),
    unsignedArtifacts: path.join(root, "unsigned-artifacts"),
  };
}

/** Resolve paths for the env-selected supported target. */
export function resolveDesktopTargetBuildPaths(
  env: NodeJS.ProcessEnv = process.env,
  appRoot: string = resolveDesktopAppRoot(),
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: string = process.arch,
): DesktopTargetBuildPaths {
  return desktopTargetBuildPaths(
    resolveDesktopBuildTarget(env, hostPlatform, hostArch),
    appRoot,
  );
}
