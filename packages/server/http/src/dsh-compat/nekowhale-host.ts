/**
 * Cordis host apply for `dsh-nekowhale-stickers`.
 *
 * Wires tools / skills / systemPrompt / settings / webServer / attachments,
 * publishes Host-facing tool + skill + prompt surfaces, and contributes the
 * `/x-nekowhale-stickers` HTTP routes from upstream `lib/index.js`.
 *
 * Settings follow DSH LIVE_KEYS: Face `settings.yaml` persistence + watch so
 * Settings UI mutate remounts Agent tools without a blind poll.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  DshAdapterContribution,
  DshCompatWireOptions,
} from "./adapter-types.js";
import { createCordisAttachmentsBridge } from "./cordis-attachments-bridge.js";
import { createCommunityCordisHostSession } from "./community-cordis-host-session.js";
import {
  clearCommunityHostSurfaces,
  publishCommunityHostSurfaces,
} from "./community-host-registry.js";
import { faceSettingsStoreFromWire } from "./community-settings-store.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { ensureHostModuleRemap } from "./host-module-remap.js";
import { isPluginPackageFamily } from "./plugin-package-id.js";

const NEKOWHALE_PACKAGE = "dsh-nekowhale-stickers";
const SETTINGS_NS = "nekowhale-stickers";
const DEFAULT_ROUTE = "/x-nekowhale-stickers";

export function isNekowhaleStickersPackage(packageName: string): boolean {
  return isPluginPackageFamily(packageName, NEKOWHALE_PACKAGE);
}

export function hasNekowhaleHostLib(pkgRoot: string): boolean {
  return existsSync(path.join(pkgRoot, "lib", "index.js"));
}

/**
 * Apply staged nekowhale-stickers host half.
 */
export async function tryApplyNekowhaleHost(
  pkgRoot: string,
  packageName: string,
  wire: DshCompatWireOptions,
): Promise<DshAdapterContribution | undefined> {
  if (!isNekowhaleStickersPackage(packageName) || !hasNekowhaleHostLib(pkgRoot)) {
    return undefined;
  }

  ensureHostModuleRemap();

  const session = createCommunityCordisHostSession({
    logPrefix: NEKOWHALE_PACKAGE,
    packageName,
    ...(wire.xrkHome ? { xrkHome: wire.xrkHome } : {}),
  });
  const { logger, disposers, dshHome } = session;
  const settingsStore = faceSettingsStoreFromWire(wire);

  let publish: () => void = () => undefined;
  let republishTimer: ReturnType<typeof setTimeout> | undefined;
  const schedulePublish = () => {
    if (republishTimer) clearTimeout(republishTimer);
    // Wait for plugin onChange remount fibers to settle (DSH LIVE remount).
    republishTimer = setTimeout(() => {
      republishTimer = undefined;
      try {
        publish();
      } catch {
        /* ignore */
      }
    }, 80);
    republishTimer.unref?.();
  };

  session.provideHostSurfaces({
    settingsConfigure: true,
    agentSurfaces: true,
    attachments: createCordisAttachmentsBridge(dshHome),
    ...(settingsStore ? { settingsStore } : {}),
    onSettingsChange: () => {
      schedulePublish();
    },
  });
  session.trackEffectsAndFibers();

  // Align defaults with upstream Config Schema (volatile keys stay live).
  const ok = await session.applyEntry(path.join(pkgRoot, "lib", "index.js"), {
    autoSync: "lazy",
    promptMode: "skill",
    persona: "self",
    frequency: "normal",
    pet: true,
    petHeight: 211,
    petBubbles: true,
    petBalance: true,
    templates: true,
    agentCuration: true,
    banwords: true,
    stickerSize: 100,
    searchLimit: 5,
    indexLimit: 40,
    returnImageToModel: false,
    routePath: DEFAULT_ROUTE,
  });
  if (!ok) {
    logger.warn("Cordis apply failed");
    return undefined;
  }

  session.sealHttp();

  const agent = session.agent;
  const stagedSkill = path.join(pkgRoot, "skills", "nekowhale-stickers");
  if (agent && existsSync(path.join(stagedSkill, "SKILL.md"))) {
    agent.skills.addSkillDir(stagedSkill);
  }

  publish = () => {
    if (!agent) return;
    publishCommunityHostSurfaces(packageName, {
      tools: agent.tools.toCoreTools(),
      skillDirs: agent.skills.skillDirs(),
      promptSections: agent.systemPrompt.sections(),
      indexGlobals: agent.indexInject.globals(),
    });
  };
  publish();
  disposers.push(() => {
    clearCommunityHostSurfaces(packageName);
  });
  disposers.push(() => {
    if (republishTimer) clearTimeout(republishTimer);
  });

  // Face Settings UI mutate → LIVE remount (same ns as installSection).
  const unwatch = wire.watchCommunitySettingsNamespace?.(
    SETTINGS_NS,
    schedulePublish,
  );
  if (unwatch) disposers.push(unwatch);

  const { http: gatedHttp, rpc: gatedRpc } =
    await session.finishLive(packageName);

  return {
    meta: {
      id: "dsh-nekowhale-stickers-host",
      package: packageName,
      httpPrefixes: [DEFAULT_ROUTE],
      rpcChannels: Object.keys(gatedRpc),
      description: `${DSH_COMPAT_ADAPTER}: Nekowhale stickers Cordis host half`,
    },
    ...(gatedHttp.length ? { http: gatedHttp } : {}),
    ...(Object.keys(gatedRpc).length ? { rpc: gatedRpc } : {}),
  };
}
