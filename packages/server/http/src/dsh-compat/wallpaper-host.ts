/**
 * Cordis host apply for `dsh-plugin-wallpaper-engine`.
 *
 * Live HTTP from upstream `lib/index.js` wins over the baseline
 * wallpaper bridge (apply contributions register first). Baseline remains
 * for installs without staged lib / apply failure.
 *
 * Settings use Face `settings.yaml` when wire provides the community store
 * (DSH installSection / LIVE keys); otherwise Cordis memory map.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Context } from "@xrkseek/cordis";
import type {
  DshAdapterContribution,
  DshCompatWireOptions,
} from "./adapter-types.js";
import { createCommunityCordisHostSession } from "./community-cordis-host-session.js";
import { clearCommunityHostSurfaces } from "./community-host-registry.js";
import { faceSettingsStoreFromWire } from "./community-settings-store.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { ensureHostModuleRemap } from "./host-module-remap.js";
import { isPluginPackageFamily } from "./plugin-package-id.js";

const WALLPAPER_PACKAGE = "dsh-plugin-wallpaper-engine";
const SETTINGS_NS = "wallpaper-engine";

const SUBPACKAGE_NAMES = [
  "dsh-plugin-wallpaper-engine-about-notice",
  "dsh-plugin-wallpaper-engine-mascot-avatar",
  "dsh-plugin-wallpaper-engine-media-bridge",
  "dsh-plugin-wallpaper-engine-pet-link",
  "dsh-plugin-wallpaper-engine-fx",
  "dsh-plugin-wallpaper-engine-parallax",
  "dsh-plugin-wallpaper-engine-fonts",
  "dsh-plugin-wallpaper-engine-glass",
] as const;

export function isWallpaperEnginePackage(packageName: string): boolean {
  return isPluginPackageFamily(packageName, WALLPAPER_PACKAGE);
}

export function hasWallpaperEngineHostLib(pkgRoot: string): boolean {
  return existsSync(path.join(pkgRoot, "lib", "index.js"));
}

/**
 * Apply staged wallpaper-engine host half. Returns HTTP contribution for
 * dsh-compat (registered before baseline → live routes win).
 */
export async function tryApplyWallpaperEngineHost(
  pkgRoot: string,
  packageName: string,
  wire: DshCompatWireOptions,
): Promise<DshAdapterContribution | undefined> {
  if (
    !isWallpaperEnginePackage(packageName) ||
    !hasWallpaperEngineHostLib(pkgRoot)
  ) {
    return undefined;
  }

  ensureHostModuleRemap();

  const session = createCommunityCordisHostSession({
    logPrefix: WALLPAPER_PACKAGE,
    packageName,
    ...(wire.xrkHome ? { xrkHome: wire.xrkHome } : {}),
  });
  const { root, logger, disposers } = session;
  const settingsStore = faceSettingsStoreFromWire(wire);

  session.provideHostSurfaces({
    settingsConfigure: true,
    // Agent surfaces so installSection / settings peek hit Face yaml (DSH).
    agentSurfaces: true,
    ...(settingsStore ? { settingsStore } : {}),
  });
  session.trackEffectsAndFibers();

  const ok = await session.applyEntry(
    path.join(pkgRoot, "lib", "index.js"),
    {},
  );
  if (!ok) {
    logger.warn("Cordis apply failed; baseline wallpaper bridge remains");
    return undefined;
  }

  session.sealHttp();
  await tryApplyWallpaperSubpackages(pkgRoot, root, logger);

  disposers.push(() => {
    clearCommunityHostSurfaces(packageName);
  });

  // Touch Face ns so hydrate/defaults exist even if upstream skips installSection.
  settingsStore?.ensure(SETTINGS_NS, {
    enabled: false,
    source: "local",
    playlists: [],
  });

  const { http: gatedHttp, rpc: gatedRpc } =
    await session.finishLive(packageName);

  if (gatedHttp.length === 0) {
    logger.warn("apply produced no HTTP routes; baseline bridge remains");
    return undefined;
  }

  return {
    meta: {
      id: "dsh-plugin-wallpaper-engine-host",
      package: packageName,
      httpPrefixes: ["/wallpaper-engine", "/scene-frame", "/scene-anim"],
      rpcChannels: Object.keys(gatedRpc),
      description: `${DSH_COMPAT_ADAPTER}: Wallpaper Engine Cordis host half`,
    },
    http: gatedHttp,
    ...(Object.keys(gatedRpc).length ? { rpc: gatedRpc } : {}),
  };
}

async function tryApplyWallpaperSubpackages(
  pkgRoot: string,
  root: Context,
  logger: { warn: (...args: unknown[]) => void },
): Promise<void> {
  for (const name of SUBPACKAGE_NAMES) {
    const entry = path.join(pkgRoot, "node_modules", name, "lib", "index.js");
    const alt = path.join(pkgRoot, "node_modules", name, "index.js");
    const file = existsSync(entry) ? entry : existsSync(alt) ? alt : undefined;
    if (!file) continue;
    try {
      const mod = (await import(
        /* @vite-ignore */ pathToFileURL(file).href
      )) as {
        apply?: (ctx: Context, config?: Record<string, unknown>) => void;
        default?: {
          apply?: (ctx: Context, config?: Record<string, unknown>) => void;
        };
        inject?: string[];
        name?: string;
      };
      const apply =
        typeof mod.apply === "function"
          ? mod.apply
          : typeof mod.default?.apply === "function"
            ? mod.default.apply
            : undefined;
      if (!apply) continue;
      const plugin = {
        name: mod.name ?? name,
        inject: mod.inject ?? ["webServer"],
        apply,
      };
      const fiber = root.plugin(plugin, {});
      await fiber.await();
    } catch (error) {
      logger.warn(`subpackage ${name} apply skipped`, error);
    }
  }
}
