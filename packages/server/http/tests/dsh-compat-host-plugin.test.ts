import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPluginLoader } from "@xrkseek/server-loader";
import {
  DSH_COMPAT_HOST_PLUGIN_ID,
  ensureDshCompatHostPlugin,
} from "../src/dsh-compat/create-host-plugin.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

describe("ensureDshCompatHostPlugin", () => {
  it("loads built-in extensions/dsh-compat when present", async () => {
    const loader = createPluginLoader();
    await ensureDshCompatHostPlugin(loader, { cwd: repoRoot });
    expect(loader.list().map((p) => p.id)).toContain(DSH_COMPAT_HOST_PLUGIN_ID);
    const host = loader.list().find((p) => p.id === DSH_COMPAT_HOST_PLUGIN_ID);
    expect(host?.kind).toBe("host");
    expect(typeof host?.createPublicHandler).toBe("function");
  });

  it("is idempotent when plugin already registered", async () => {
    const loader = createPluginLoader();
    await ensureDshCompatHostPlugin(loader, { cwd: repoRoot });
    await ensureDshCompatHostPlugin(loader, { cwd: repoRoot });
    expect(
      loader.list().filter((p) => p.id === DSH_COMPAT_HOST_PLUGIN_ID),
    ).toHaveLength(1);
  });
});
