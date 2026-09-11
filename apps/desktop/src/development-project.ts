/**
 * Disposable development project projection (ADR-0008).
 * Links the current workspace Host (and optional CLI) into
 * `.desktop-build/development/project` for unpackaged Electron.
 * No Cordis overlay; no offline seed unpack.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  DESKTOP_CLI_PACKAGE,
  DESKTOP_HOST_PACKAGE,
  DESKTOP_HOST_RUNTIME_FILES,
} from "./core-package-set.js";
import type { DesktopRelease } from "./release.js";

/** Private npm project name for the unpackaged Desktop development profile. */
export const DESKTOP_DEVELOPMENT_PROJECT_NAME =
  "@xrkseek/harness-desktop-runtime" as const;

interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
}

/** Inputs whose locations differ between the launcher and isolated tests. */
export interface PrepareDesktopDevelopmentProjectOptions {
  /** Directory replaced with the generated development project. */
  readonly projectDir: string;
  /** Current workspace's private Desktop Host application directory. */
  readonly hostDir: string;
  /** pnpm workspace virtual-hoist / shared `node_modules` to mirror. */
  readonly dependencyDir: string;
  /** Release identity written into disposable project metadata. */
  readonly release: DesktopRelease;
  /**
   * Optional `apps/cli` directory. Linked when present; version need not match
   * the Desktop release (public CLI line ≠ Desktop identity).
   */
  readonly cliDir?: string;
}

function readManifest(filePath: string): PackageManifest {
  return JSON.parse(readFileSync(filePath, "utf8")) as PackageManifest;
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, undefined, 2)}\n`, {
    mode: 0o600,
  });
}

function removeOwnedPath(target: string): void {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    unlinkSync(target);
    return;
  }
  if (stat.isDirectory()) {
    rmSync(target, { recursive: true });
    return;
  }
  unlinkSync(target);
}

function linkDirectory(source: string, destination: string): void {
  mkdirSync(path.dirname(destination), { recursive: true });
  symlinkSync(
    realpathSync(source),
    destination,
    process.platform === "win32" ? "junction" : "dir",
  );
}

function mirrorDependencyLinks(
  sourceRoot: string,
  destinationRoot: string,
): void {
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.name === ".bin") continue;
    const source = path.join(sourceRoot, entry.name);
    if (
      entry.name.startsWith("@") &&
      (entry.isDirectory() || entry.isSymbolicLink())
    ) {
      mkdirSync(path.join(destinationRoot, entry.name), { recursive: true });
      for (const scoped of readdirSync(source, { withFileTypes: true })) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue;
        linkDirectory(
          path.join(source, scoped.name),
          path.join(destinationRoot, entry.name, scoped.name),
        );
      }
      continue;
    }
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      linkDirectory(source, path.join(destinationRoot, entry.name));
    }
  }
}

function workspaceFile(): string {
  return "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n";
}

/**
 * Create metadata for the unpackaged development project that links the workspace.
 */
export function createDesktopDevelopmentProjectMetadata(
  projectDir: string,
  release: DesktopRelease,
  options: { readonly includeCli?: boolean } = {},
): void {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 });
  const dependencies: Record<string, string> = {
    [DESKTOP_HOST_PACKAGE]: release.version,
  };
  if (options.includeCli === true) {
    dependencies[DESKTOP_CLI_PACKAGE] = release.version;
  }
  writeJson(path.join(projectDir, "package.json"), {
    name: DESKTOP_DEVELOPMENT_PROJECT_NAME,
    private: true,
    version: "0.0.0",
    dependencies,
  });
  writeFileSync(path.join(projectDir, "pnpm-workspace.yaml"), workspaceFile(), {
    mode: 0o600,
  });
  writeJson(path.join(projectDir, "desktop-release.json"), release);
}

/**
 * Replace one disposable project with links to the current built workspace.
 * @returns the absolute project directory supplied by the caller.
 */
export function prepareDesktopDevelopmentProject(
  options: PrepareDesktopDevelopmentProjectOptions,
): string {
  const hostManifest = readManifest(
    path.join(options.hostDir, "package.json"),
  );
  if (
    hostManifest.name !== DESKTOP_HOST_PACKAGE ||
    hostManifest.version !== options.release.version
  ) {
    throw new Error(
      `xrk desktop development: apps/desktop-host must be ${DESKTOP_HOST_PACKAGE}@${options.release.version}, found ${String(hostManifest.name)}@${String(hostManifest.version)}`,
    );
  }
  const hostEntry = path.join(
    options.hostDir,
    ...DESKTOP_HOST_RUNTIME_FILES[0].split("/"),
  );
  if (!existsSync(hostEntry)) {
    throw new Error(
      `xrk desktop development: ${DESKTOP_HOST_PACKAGE}/${DESKTOP_HOST_RUNTIME_FILES[0]} is missing; run pnpm build:desktop`,
    );
  }
  if (!existsSync(options.dependencyDir)) {
    throw new Error(
      "xrk desktop development: workspace dependency links are missing; run pnpm install",
    );
  }

  let includeCli = false;
  if (options.cliDir !== undefined) {
    const cliManifest = readManifest(
      path.join(options.cliDir, "package.json"),
    );
    if (cliManifest.name !== DESKTOP_CLI_PACKAGE) {
      throw new Error(
        `xrk desktop development: apps/cli must be ${DESKTOP_CLI_PACKAGE}, found ${String(cliManifest.name)}`,
      );
    }
    includeCli = true;
  }

  removeOwnedPath(options.projectDir);
  createDesktopDevelopmentProjectMetadata(options.projectDir, options.release, {
    includeCli,
  });
  const destinationModules = path.join(options.projectDir, "node_modules");
  mkdirSync(destinationModules, { recursive: true });
  mirrorDependencyLinks(options.dependencyDir, destinationModules);

  const hostLink = path.join(
    destinationModules,
    ...DESKTOP_HOST_PACKAGE.split("/"),
  );
  removeOwnedPath(hostLink);
  linkDirectory(options.hostDir, hostLink);

  if (options.cliDir !== undefined) {
    const cliLink = path.join(
      destinationModules,
      ...DESKTOP_CLI_PACKAGE.split("/"),
    );
    removeOwnedPath(cliLink);
    linkDirectory(options.cliDir, cliLink);
  }

  return options.projectDir;
}
