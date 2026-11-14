/**
 * Stage Cordis host trees + declared runtime deps for community packages
 * (wallpaper-engine · nekowhale-stickers). Deps land under the staged plugin
 * `node_modules` — never in the monorepo lockfile.
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { isPluginPackageFamily } from "./package-id.js";
import { resolveNpmPackInvocation, planNpmPackSpawn } from "./fetch-pack.js";

const WALLPAPER = "dsh-plugin-wallpaper-engine";
const NEKOWHALE = "dsh-nekowhale-stickers";

/** Platform-inappropriate deps skipped when staging (Win has no x11). */
const SKIP_DEPS_BY_PLATFORM: Record<string, readonly string[]> = {
  win32: ["x11"],
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function copyIfExists(src: string, dest: string, recursive = false): boolean {
  if (!existsSync(src)) return false;
  if (recursive) {
    cpSync(src, dest, { recursive: true });
  } else {
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
  return true;
}

/**
 * Install `dependencies` (+ optionalDependencies best-effort) into `destDir`
 * via the same npm resolution path as `npm pack` (Desktop vendored npm).
 */
export function stagePluginRuntimeDeps(
  destDir: string,
  options?: {
    readonly skipOptional?: boolean;
    readonly platform?: NodeJS.Platform;
  },
): boolean {
  const pkgPath = path.join(destDir, "package.json");
  if (!existsSync(pkgPath)) return false;
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  } catch {
    return false;
  }
  const deps = asRecord(pkg.dependencies) ?? {};
  const optional = asRecord(pkg.optionalDependencies) ?? {};
  const platform = options?.platform ?? process.platform;
  const skip = new Set(SKIP_DEPS_BY_PLATFORM[platform] ?? []);
  const filtered: Record<string, string> = {};
  for (const [name, ver] of Object.entries(deps)) {
    if (skip.has(name)) continue;
    if (typeof ver === "string") filtered[name] = ver;
  }
  const optFiltered: Record<string, string> = {};
  if (!options?.skipOptional) {
    for (const [name, ver] of Object.entries(optional)) {
      if (skip.has(name)) continue;
      if (typeof ver === "string") optFiltered[name] = ver;
    }
  }
  if (
    Object.keys(filtered).length === 0 &&
    Object.keys(optFiltered).length === 0
  ) {
    return true;
  }
  // Rewrite package.json so npm does not try to install skipped / peer DSH pkgs.
  const stagedPkg = {
    ...pkg,
    dependencies: filtered,
    ...(Object.keys(optFiltered).length
      ? { optionalDependencies: optFiltered }
      : { optionalDependencies: undefined }),
    // Peers are remapped by Host; do not install @deepseek-ai/* into stage.
    peerDependencies: undefined,
    peerDependenciesMeta: undefined,
    devDependencies: undefined,
  };
  writeFileSync(pkgPath, `${JSON.stringify(stagedPkg, null, 2)}\n`, "utf8");

  const npm = resolveNpmPackInvocation();
  // Official registry only (no npmmirror). Inherit HTTPS_PROXY / ALL_PROXY from
  // the caller so Clash (or similar) can reach registry.npmjs.org.
  const npmArgs = [
    "install",
    "--omit=dev",
    "--omit=peer",
    "--no-fund",
    "--no-audit",
    "--no-package-lock",
    "--registry=https://registry.npmjs.org",
  ];
  const plan = planNpmPackSpawn(npm, npmArgs);
  const result = spawnSync(plan.file, [...plan.args], {
    cwd: destDir,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    env: process.env,
    ...(plan.windowsVerbatimArguments
      ? { windowsVerbatimArguments: true }
      : {}),
  });
  if ((result.status ?? 1) !== 0) {
    const err = (result.stderr || result.stdout || result.error?.message || "")
      .trim()
      .slice(0, 800);
    const proxyHint =
      /ECONNRESET|ETIMEDOUT|ENOTFOUND|network/i.test(err) &&
      !process.env.HTTPS_PROXY?.trim() &&
      !process.env.HTTP_PROXY?.trim() &&
      !process.env.ALL_PROXY?.trim()
        ? " (tip: set HTTPS_PROXY to reach registry.npmjs.org; Cordis host half needs these deps)"
        : "";
    throw new Error(
      `stagePluginRuntimeDeps: npm install failed in ${destDir}${err ? `: ${err}` : ""}${proxyHint}`,
    );
  }
  return true;
}

/**
 * Stage wallpaper-engine Cordis host: lib/ · cordis.patch.yml · locale · assets
 * · icon · runtime deps (webwallgl; subpackages when declared).
 */
export function stageWallpaperEngineHost(
  root: string,
  destDir: string,
  packageName: string,
): boolean {
  if (!isPluginPackageFamily(packageName, WALLPAPER)) return false;
  const libSrc = path.join(root, "lib");
  if (!existsSync(path.join(libSrc, "index.js"))) return false;
  cpSync(libSrc, path.join(destDir, "lib"), { recursive: true });
  copyIfExists(
    path.join(root, "cordis.patch.yml"),
    path.join(destDir, "cordis.patch.yml"),
  );
  copyIfExists(path.join(root, "locale"), path.join(destDir, "locale"), true);
  copyIfExists(path.join(root, "assets"), path.join(destDir, "assets"), true);
  copyIfExists(path.join(root, "icon.png"), path.join(destDir, "icon.png"));
  const pkgJson = path.join(root, "package.json");
  if (existsSync(pkgJson) && !existsSync(path.join(destDir, "package.json"))) {
    copyFileSync(pkgJson, path.join(destDir, "package.json"));
  }
  try {
    stagePluginRuntimeDeps(destDir);
  } catch (error) {
    // Keep lib staged; Host can still apply with degraded Scene (no webwallgl).
    console.warn(
      `[stage] ${WALLPAPER} deps incomplete:`,
      error instanceof Error ? error.message : error,
    );
  }
  return true;
}

/**
 * Stage nekowhale-stickers Cordis host: lib/ · meta/ · skills/ · client/ui ·
 * locale · cordis.patch.yml · deps (gifenc / gifuct-js; canvas optional).
 */
export function stageNekowhaleHost(
  root: string,
  destDir: string,
  packageName: string,
): boolean {
  if (!isPluginPackageFamily(packageName, NEKOWHALE)) return false;
  const libSrc = path.join(root, "lib");
  if (!existsSync(path.join(libSrc, "index.js"))) return false;
  cpSync(libSrc, path.join(destDir, "lib"), { recursive: true });
  copyIfExists(path.join(root, "meta"), path.join(destDir, "meta"), true);
  copyIfExists(path.join(root, "skills"), path.join(destDir, "skills"), true);
  copyIfExists(
    path.join(root, "client", "ui"),
    path.join(destDir, "client", "ui"),
    true,
  );
  copyIfExists(path.join(root, "locale"), path.join(destDir, "locale"), true);
  copyIfExists(
    path.join(root, "cordis.patch.yml"),
    path.join(destDir, "cordis.patch.yml"),
  );
  copyIfExists(path.join(root, "icon.webp"), path.join(destDir, "icon.webp"));
  copyIfExists(path.join(root, "NOTICE"), path.join(destDir, "NOTICE"));
  copyIfExists(
    path.join(root, "LICENSE-ASSETS"),
    path.join(destDir, "LICENSE-ASSETS"),
  );
  const pkgJson = path.join(root, "package.json");
  if (existsSync(pkgJson) && !existsSync(path.join(destDir, "package.json"))) {
    copyFileSync(pkgJson, path.join(destDir, "package.json"));
  }
  try {
    // canvas is optional — skip so Windows without build tools still installs gifenc.
    stagePluginRuntimeDeps(destDir, { skipOptional: true });
  } catch (error) {
    console.warn(
      `[stage] ${NEKOWHALE} deps incomplete:`,
      error instanceof Error ? error.message : error,
    );
  }
  return true;
}

export function isLibCordisHostIncomplete(
  destDir: string,
  packageName: string,
): boolean {
  if (!existsSync(path.join(destDir, "client.js"))) return false;
  if (
    isPluginPackageFamily(packageName, WALLPAPER) ||
    isPluginPackageFamily(packageName, NEKOWHALE)
  ) {
    return !existsSync(path.join(destDir, "lib", "index.js"));
  }
  return false;
}

export function hasStagedLibCordisHost(
  destDir: string,
  packageName: string,
): boolean {
  if (
    isPluginPackageFamily(packageName, WALLPAPER) ||
    isPluginPackageFamily(packageName, NEKOWHALE)
  ) {
    return existsSync(path.join(destDir, "lib", "index.js"));
  }
  return false;
}
