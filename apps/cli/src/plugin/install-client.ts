/**
 * Stage a client plugin: copy client.js (+ optional LICENSE + lazy chunks)
 * under web/plugins.
 *
 * Cordis Host plugins (e.g. dsh-better-sidebar) ship `lib/client-<name>.js`
 * chunks loaded via `/sidebar/bundle/<name>.js`. Without copying them, Host
 * can only serve stubs and Terminal/Editor stay incomplete.
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { ClassifiedPackage } from "./classify.js";
import { clientInstallDir } from "./inventory.js";

const CLIENT_CHUNK_RE = /^client-(.+)\.js$/;

/** Extra package dirs community clients fetch over Host HTTP (e.g. niulai KWS · skin artwork). */
const EXTRA_ASSET_DIRS = [
  "kws",
  "assets",
  "static",
  "preview",
  "locale",
  "skins",
] as const;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/** Stage `xrk.host.json` for Host provider compose (from file or package.json). */
function stageHostManifest(root: string, destDir: string): void {
  const dest = path.join(destDir, "xrk.host.json");
  const file = path.join(root, "xrk.host.json");
  if (existsSync(file)) {
    copyFileSync(file, dest);
    return;
  }
  let pkg: Record<string, unknown> | undefined;
  try {
    pkg = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    return;
  }
  const nested =
    asRecord(pkg.xrkseek)?.host ??
    asRecord(pkg.dsh)?.host ??
    pkg["dsh.host"];
  const manifest = asRecord(nested);
  if (!manifest) return;
  writeFileSync(dest, `${JSON.stringify(manifest, null, 2)}\n`);
}

function stageHostModule(root: string, destDir: string): void {
  const candidates = [
    "host.mjs",
    "host.js",
    "lib/host.mjs",
    "lib/host/index.mjs",
    "dist/host.mjs",
  ];
  for (const rel of candidates) {
    const src = path.join(root, rel);
    if (!existsSync(src)) continue;
    copyFileSync(src, path.join(destDir, "host.mjs"));
    return;
  }
}

/**
 * WorkBuddy Cordis host half lives under `lib/index.js` (+ peers). Stage the
 * whole `lib/` tree so Host can `import` apply without re-fetching npm.
 */
function stageWorkBuddyHostLib(
  root: string,
  destDir: string,
  packageName: string,
): void {
  if (packageName.trim() !== "dsh-workbuddy-connect") return;
  const libSrc = path.join(root, "lib");
  if (!existsSync(libSrc)) return;
  cpSync(libSrc, path.join(destDir, "lib"), { recursive: true });
}

/**
 * Our Free Model Cordis host half is package-root `index.js` + `src/` /
 * `adapter/` / channel-pack vendor. Stage those so Host can apply.
 */
function stageOurFreeModelHost(
  root: string,
  destDir: string,
  packageName: string,
): void {
  if (packageName.trim() !== "dsh-our-free-model") return;
  const indexJs = path.join(root, "index.js");
  if (!existsSync(indexJs)) return;
  copyFileSync(indexJs, path.join(destDir, "index.js"));
  for (const rel of ["src", "adapter", "locale"] as const) {
    const src = path.join(root, rel);
    if (!existsSync(src)) continue;
    cpSync(src, path.join(destDir, rel), { recursive: true });
  }
  for (const rel of [
    "cordis.patch.yml",
    "icon.svg",
    "vendor/channel-pack/pack.js",
    "vendor/channel-pack/qoder-auth-wasm.wasm",
    "vendor/channel-pack/NOTICE.md",
    "vendor/channel-pack/LICENSE",
  ] as const) {
    const src = path.join(root, rel);
    if (!existsSync(src)) continue;
    const dest = path.join(destDir, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

/**
 * Upstream probe slot uses `selection === void 0` but the model directory can
 * yield `null` (non-WorkBuddy model) → crash on `.provider`. Normalize to
 * nullish checks when staging.
 */
export function patchWorkBuddyClientProbeNull(clientJsPath: string): boolean {
  if (!existsSync(clientJsPath)) return false;
  const src = readFileSync(clientJsPath, "utf8");
  const next = src
    .replaceAll(
      "selection === void 0 ? void 0 : cardVariantFor(selection.provider)",
      "selection == null ? void 0 : cardVariantFor(selection.provider)",
    )
    .replaceAll(
      "card === void 0 || selection === void 0 ? void 0 :",
      "card == null || selection == null ? void 0 :",
    )
    .replaceAll(
      "card === void 0 || selection === void 0 || key === void 0 ? null",
      "card == null || selection == null || key == null ? null",
    );
  if (next === src) return false;
  writeFileSync(clientJsPath, next, "utf8");
  return true;
}

function stageLazyChunks(root: string, destDir: string): void {
  const libDir = path.join(root, "lib");
  if (!existsSync(libDir)) return;
  const chunksDir = path.join(destDir, "chunks");
  let made = false;
  for (const name of readdirSync(libDir)) {
    const m = CLIENT_CHUNK_RE.exec(name);
    if (!m) continue;
    const chunkName = m[1]!;
    if (chunkName === "registry") continue; // loader helper, not a bundle tab
    if (!made) {
      mkdirSync(chunksDir, { recursive: true });
      made = true;
    }
    copyFileSync(path.join(libDir, name), path.join(chunksDir, `${chunkName}.js`));
  }
}

/** Copy known static asset folders (KWS wasm · public assets) next to client.js. */
function stageExtraAssetDirs(root: string, destDir: string): void {
  for (const name of EXTRA_ASSET_DIRS) {
    const src = path.join(root, name);
    if (!existsSync(src)) continue;
    cpSync(src, path.join(destDir, name), { recursive: true });
  }
}

export function installClientBundle(
  pluginsDir: string,
  classified: ClassifiedPackage,
): void {
  if (!classified.clientJs) {
    throw new Error(`${classified.name}: missing client.js`);
  }
  const destDir = clientInstallDir(pluginsDir, classified.name);
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  copyFileSync(classified.clientJs, path.join(destDir, "client.js"));
  if (classified.name.trim() === "dsh-workbuddy-connect") {
    patchWorkBuddyClientProbeNull(path.join(destDir, "client.js"));
  }
  const license = path.join(classified.root, "LICENSE");
  if (existsSync(license)) {
    copyFileSync(license, path.join(destDir, "LICENSE"));
  }
  stageLazyChunks(classified.root, destDir);
  stageExtraAssetDirs(classified.root, destDir);
  stageHostModule(classified.root, destDir);
  stageWorkBuddyHostLib(classified.root, destDir, classified.name);
  stageOurFreeModelHost(classified.root, destDir, classified.name);
  const pkgJson = path.join(classified.root, "package.json");
  if (existsSync(pkgJson)) {
    copyFileSync(pkgJson, path.join(destDir, "package.json"));
  }
  // Skin packs resolve `/skin-assets/<id>/…` via Host using this id map.
  const skinJson = path.join(classified.root, "skin.json");
  if (existsSync(skinJson)) {
    copyFileSync(skinJson, path.join(destDir, "skin.json"));
  }
  stageHostManifest(classified.root, destDir);
}

/** Walk upward and remove empty directories until `stopAt` (non-inclusive). */
export function pruneEmptyParents(dir: string, stopAt: string): void {
  const stop = path.resolve(stopAt);
  let current = path.resolve(dir);
  while (current !== stop) {
    const rel = path.relative(stop, current);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) break;
    try {
      if (!existsSync(current)) break;
      if (readdirSync(current).length > 0) break;
      rmdirSync(current);
      current = path.dirname(current);
    } catch {
      break;
    }
  }
}

export function removeClientBundle(pluginsDir: string, name: string): void {
  const destDir = clientInstallDir(pluginsDir, name);
  const pluginsRoot = path.join(pluginsDir, "web", "plugins");
  if (existsSync(destDir)) {
    rmSync(destDir, { recursive: true, force: true });
  }
  pruneEmptyParents(path.dirname(destDir), pluginsRoot);
}
