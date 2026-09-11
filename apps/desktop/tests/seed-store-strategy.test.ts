import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_SEED_DEFERRED,
  DESKTOP_SEED_LAYOUT,
  DESKTOP_SEED_STORE_STRATEGY,
  isDesktopOfflineSeedReady,
  isDesktopSeedCapabilityDeferred,
  resolveDesktopInstallMode,
  resolveDesktopSeedResourceRoot,
  resolveDesktopUserPnpmStore,
} from "../src/seed-store-strategy.js";

describe("desktop seed/store strategy (MVP)", () => {
  it("orders development-projection before offline-seed", () => {
    expect(DESKTOP_SEED_STORE_STRATEGY.mvpPhase).toBe("development-projection");
    expect(DESKTOP_SEED_STORE_STRATEGY.nextPhase).toBe("offline-seed");
    expect(resolveDesktopInstallMode({ isPackaged: false })).toBe(
      "development-projection",
    );
    expect(resolveDesktopInstallMode({ isPackaged: true })).toBe("offline-seed");
  });

  it("keeps offline seed not ready and defers shard notarization", () => {
    expect(isDesktopOfflineSeedReady()).toBe(false);
    expect(DESKTOP_SEED_DEFERRED).toContain("store-archives-16-shards");
    expect(DESKTOP_SEED_DEFERRED).toContain("macos-cas-object-signing-rewrite");
    expect(isDesktopSeedCapabilityDeferred("store-archives-16-shards")).toBe(
      true,
    );
    expect(DESKTOP_SEED_LAYOUT.storeArchiveFile).toBe("store.tar");
    expect(DESKTOP_SEED_LAYOUT.storeDir).toBe("store");
  });

  it("resolves packaged seed resource and user store paths", () => {
    const resources = path.join("C:", "App", "Resources");
    expect(resolveDesktopSeedResourceRoot(resources)).toBe(
      path.join(resources, "seed"),
    );
    const store = path.join("C:", "home", "desktop", "pnpm", "store");
    expect(resolveDesktopUserPnpmStore(store)).toBe(path.resolve(store));
  });
});
