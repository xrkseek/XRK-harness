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
import { fetchPackage } from "./fetch-pack.js";
import { clientInstallDir, readInventory } from "./inventory.js";
import {
  isPluginPackageFamily,
  isSamePluginPackage,
  unscopedPackageName,
} from "./package-id.js";

const CLIENT_CHUNK_RE = /^client-(.+)\.js$/;

/** Extra package dirs community clients fetch over Host HTTP (e.g. niulai KWS · skin artwork · theme audio). */
const EXTRA_ASSET_DIRS = [
  "kws",
  "assets",
  "static",
  "preview",
  "locale",
  "skins",
  "sounds",
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
  if (!isPluginPackageFamily(packageName, "dsh-workbuddy-connect")) return;
  const libSrc = path.join(root, "lib");
  if (!existsSync(libSrc)) return;
  cpSync(libSrc, path.join(destDir, "lib"), { recursive: true });
}

/**
 * Trees commonly required beside package-root Cordis `index.js` (OFM and
 * similar community hosts). Only copy what exists — no package-name list.
 */
const ROOT_CORDIS_HOST_DIRS = ["src", "adapter", "vendor", "locale"] as const;
const ROOT_CORDIS_HOST_FILES = ["cordis.patch.yml", "icon.svg"] as const;

function packageEntryPointsAtRootIndex(pkg: Record<string, unknown>): boolean {
  const main =
    typeof pkg.main === "string" ? pkg.main.trim().replace(/^\.\//, "") : "";
  if (main === "index.js") return true;
  const exportsField = asRecord(pkg.exports);
  if (exportsField) {
    const root = exportsField["."];
    if (typeof root === "string") {
      if (root.trim().replace(/^\.\//, "") === "index.js") return true;
    } else {
      const rootRec = asRecord(root);
      for (const key of ["default", "import", "require"] as const) {
        const value = rootRec?.[key];
        if (
          typeof value === "string" &&
          value.trim().replace(/^\.\//, "") === "index.js"
        ) {
          return true;
        }
      }
    }
  }
  // Cordis bundle patch implies a package-root apply entry (community layout).
  if (asRecord(asRecord(pkg.dsh)?.bundle)?.patch !== undefined) return true;
  if (asRecord(asRecord(pkg.xrk)?.bundle)?.patch !== undefined) return true;
  return false;
}

/**
 * True when staged `package.json` declares a Cordis apply entry at package-root
 * `index.js` (main / exports["."]), so a missing file is an incomplete install.
 */
export function packageDeclaresRootCordisIndex(
  destDir: string,
): boolean {
  const pkgPath = path.join(destDir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as unknown;
    return packageEntryPointsAtRootIndex(asRecord(pkg) ?? {});
  } catch {
    return false;
  }
}

/**
 * Stage package-root Cordis host half when `index.js` is present in the
 * unpacked package. Used by OFM and any community client that ships the same
 * layout — not gated on a publisher / bare family id.
 */
export function stageRootCordisHost(root: string, destDir: string): boolean {
  const indexJs = path.join(root, "index.js");
  if (!existsSync(indexJs)) return false;
  copyFileSync(indexJs, path.join(destDir, "index.js"));
  for (const rel of ROOT_CORDIS_HOST_DIRS) {
    const src = path.join(root, rel);
    if (!existsSync(src)) continue;
    cpSync(src, path.join(destDir, rel), { recursive: true });
  }
  for (const rel of ROOT_CORDIS_HOST_FILES) {
    const src = path.join(root, rel);
    if (!existsSync(src)) continue;
    copyFileSync(src, path.join(destDir, rel));
  }
  return true;
}

/** @deprecated Prefer {@link stageRootCordisHost}; kept for call-site clarity in OFM tests. */
export function stageOurFreeModelHost(
  root: string,
  destDir: string,
  _packageName?: string,
): boolean {
  return stageRootCordisHost(root, destDir);
}

/**
 * Client half on disk, package.json says root `index.js` is the apply entry,
 * but that file was never staged (common after older installs / client-only copy).
 */
export function isRootCordisHostIncomplete(destDir: string): boolean {
  if (!existsSync(path.join(destDir, "client.js"))) return false;
  if (!packageDeclaresRootCordisIndex(destDir)) return false;
  return !existsSync(path.join(destDir, "index.js"));
}

/**
 * Re-fetch inventory sources only for incomplete root-Cordis hosts.
 * Cheap when healthy (stat + package.json parse); npm pack only on heal.
 */
export function restageIncompleteCommunityHosts(
  pluginsDir: string,
): readonly string[] {
  const inv = readInventory(pluginsDir);
  const healed: string[] = [];
  for (const [name, entry] of Object.entries(inv.packages)) {
    if (entry.kind !== "client" && entry.kind !== "both") continue;
    const destDir = clientInstallDir(pluginsDir, name);
    if (!isRootCordisHostIncomplete(destDir)) continue;
    const spec =
      entry.source.trim() ||
      (entry.version ? `${name}@${entry.version}` : name);
    let unpacked: ReturnType<typeof fetchPackage> | undefined;
    try {
      unpacked = fetchPackage(spec);
      if (stageRootCordisHost(unpacked.root, destDir)) {
        healed.push(name);
      }
    } catch {
      /* leave incomplete; path-shaped catch-all / restart after a good add */
    } finally {
      unpacked?.cleanup();
    }
  }
  return healed;
}

/** @deprecated Prefer {@link restageIncompleteCommunityHosts}. */
export function restageIncompleteOurFreeModelHosts(
  pluginsDir: string,
): readonly string[] {
  return restageIncompleteCommunityHosts(pluginsDir);
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

/**
 * Align `__ModuleLoader__.load({ id })` with the install / boot-graph package
 * name when they only differ by npm scope (DSH bare stamp vs `@scope/bare`
 * republish). Leaves unrelated stamps untouched.
 */
export function alignClientModuleLoaderId(
  clientJsPath: string,
  packageName: string,
): boolean {
  if (!existsSync(clientJsPath)) return false;
  const pkg = packageName.trim();
  if (!pkg) return false;
  const src = readFileSync(clientJsPath, "utf8");
  // Multiline OFM-style: `load({\n  id: 'bare',\n  factory: …`
  const match = /__ModuleLoader__\.load\(\s*\{\s*id\s*:\s*(['"])([^'"]+)\1/.exec(
    src,
  );
  if (!match) return false;
  const stamped = match[2]!;
  if (stamped === pkg) return false;
  if (!isSamePluginPackage(stamped, pkg)) return false;
  // Same unscoped family — rewrite the stamped id to the install name.
  if (unscopedPackageName(stamped) !== unscopedPackageName(pkg)) return false;
  const quote = match[1]!;
  const from = match[0];
  const to = from.replace(
    `id: ${quote}${stamped}${quote}`,
    `id: ${quote}${pkg}${quote}`,
  );
  if (to === from) return false;
  writeFileSync(clientJsPath, src.replace(from, to), "utf8");
  return true;
}

/**
 * Re-run ModuleLoader id alignment on every staged client half.
 * Heals installs that predate align, or were copied without going through
 * {@link installClientBundle}.
 */
export function realignStagedClientModuleLoaderIds(
  pluginsDir: string,
): readonly string[] {
  const pluginsRoot = path.join(pluginsDir, "web", "plugins");
  if (!existsSync(pluginsRoot)) return [];
  const aligned: string[] = [];
  for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("@")) {
      const scopePath = path.join(pluginsRoot, entry.name);
      for (const pkg of readdirSync(scopePath, { withFileTypes: true })) {
        if (!pkg.isDirectory()) continue;
        const id = `${entry.name}/${pkg.name}`;
        const clientJs = path.join(scopePath, pkg.name, "client.js");
        if (alignClientModuleLoaderId(clientJs, id)) aligned.push(id);
      }
      continue;
    }
    const clientJs = path.join(pluginsRoot, entry.name, "client.js");
    if (alignClientModuleLoaderId(clientJs, entry.name)) {
      aligned.push(entry.name);
    }
  }
  return aligned;
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
  const clientJsDest = path.join(destDir, "client.js");
  copyFileSync(classified.clientJs, clientJsDest);
  // Every community client: bare ModuleLoader stamp ↔ scoped install name.
  alignClientModuleLoaderId(clientJsDest, classified.name);
  if (isPluginPackageFamily(classified.name, "dsh-workbuddy-connect")) {
    patchWorkBuddyClientProbeNull(clientJsDest);
  }
  const license = path.join(classified.root, "LICENSE");
  if (existsSync(license)) {
    copyFileSync(license, path.join(destDir, "LICENSE"));
  }
  stageLazyChunks(classified.root, destDir);
  stageExtraAssetDirs(classified.root, destDir);
  stageHostModule(classified.root, destDir);
  stageWorkBuddyHostLib(classified.root, destDir, classified.name);
  // Any client that ships package-root Cordis `index.js` (OFM and peers).
  stageRootCordisHost(classified.root, destDir);
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
