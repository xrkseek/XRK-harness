/**
 * Last-good config retention: parse failure keeps prior valid document;
 * persist refuses to overwrite unparsable on-disk text (DSH settings-file).
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  hydrateFaceHostSettings,
} from "../src/settings-credentials.js";
import {
  ConfigParseError,
  hydrateFaceSettingsDocument,
  persistSettingsDocument,
  resetLastGoodConfigCaches,
} from "../src/settings-document.js";
import { resetLastGoodHostMcpCache } from "../src/settings-credentials.js";
import type { FaceDrain } from "../src/context.js";

function drain(): FaceDrain {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
  };
}

function runtime(productDir: string) {
  return createFaceRuntime({
    store: createMemorySessionStore(),
    drain: drain(),
    resolveAgent: async () => {
      throw new Error("unused");
    },
    productDir,
    workspaceRoot: productDir,
  });
}

afterEach(() => {
  resetLastGoodConfigCaches();
  resetLastGoodHostMcpCache();
  vi.restoreAllMocks();
});

describe("last-good config (settings.yaml / host-settings)", () => {
  it("hydrate keeps last good settings.yaml when disk becomes corrupt", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-last-good-yaml-"));
    const file = path.join(dir, "settings.yaml");
    await writeFile(
      file,
      "agent-presets:\n  default: harness\n",
      "utf8",
    );
    const rt = runtime(dir);
    hydrateFaceSettingsDocument(rt);
    expect(rt.settingsNamespaces.ensure("agent-presets").user.default).toBe(
      "harness",
    );

    await writeFile(file, "not: [valid\nyaml: {{\n", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    hydrateFaceSettingsDocument(rt);
    expect(warn.mock.calls.some((c) => /keeping last good/i.test(String(c[0])))).toBe(
      true,
    );
    expect(rt.settingsNamespaces.ensure("agent-presets").user.default).toBe(
      "harness",
    );
  });

  it("persistSettingsDocument refuses to overwrite unparsable yaml", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-last-good-persist-"));
    const file = path.join(dir, "settings.yaml");
    await writeFile(file, "agent-presets:\n  default: minimal\n", "utf8");
    const rt = runtime(dir);
    hydrateFaceSettingsDocument(rt);

    await writeFile(file, "{{ broken\n", "utf8");
    rt.settingsNamespaces.ensure("agent-presets").user = { default: "harness" };
    await expect(
      persistSettingsDocument(rt, rt.settingsNamespaces),
    ).rejects.toThrow(ConfigParseError);

    const onDisk = await readFile(file, "utf8");
    expect(onDisk).toContain("{{ broken");
    expect(onDisk).not.toContain("harness");
  });

  it("settings.mutate rolls back memory when persist refuses corrupt disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-last-good-mutate-"));
    const file = path.join(dir, "settings.yaml");
    await writeFile(file, "locale:\n  preference: en\n", "utf8");
    const rt = runtime(dir);
    hydrateFaceSettingsDocument(rt);

    await writeFile(file, "!!!not-yaml\n", "utf8");
    const before = rt.settingsNamespaces.ensure("locale").user.preference;
    expect(before).toBe("en");

    const mut = await dispatchFaceMethod(rt, "settings.mutate", "m1", {
      ns: "locale",
      ops: [{ op: "set", path: ["preference"], value: "zh" }],
    });
    expect(mut.result.ok).toBe(false);
    if (!mut.result.ok) {
      expect(mut.result.error.code).toBe("settings-rejected");
      expect(mut.result.error.message).toMatch(/unparsable|refusing to overwrite/i);
    }
    expect(rt.settingsNamespaces.ensure("locale").user.preference).toBe("en");
    expect(await readFile(file, "utf8")).toContain("!!!not-yaml");
  });

  it("hydrateFaceHostSettings keeps last good mcp when dump is corrupt", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-last-good-host-"));
    const file = path.join(dir, "host-settings.json");
    await writeFile(
      file,
      `${JSON.stringify({
        mcp: {
          servers: [{ serverName: "demo", command: "npx" }],
          allowConnect: true,
        },
      })}\n`,
      "utf8",
    );
    const rt = runtime(dir);
    hydrateFaceHostSettings(rt);
    expect(rt.settingsNamespaces.ensure("mcp").user.servers).toEqual([
      { serverName: "demo", command: "npx" },
    ]);

    await writeFile(file, "{ broken", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    hydrateFaceHostSettings(rt);
    expect(warn.mock.calls.some((c) => /keeping last good/i.test(String(c[0])))).toBe(
      true,
    );
    expect(rt.settingsNamespaces.ensure("mcp").user.servers).toEqual([
      { serverName: "demo", command: "npx" },
    ]);
    expect(rt.settingsNamespaces.ensure("mcp").user.allowConnect).toBe(true);
  });

  it("does not hydrate mcp from settings.yaml (Host SoT is host-settings)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-mcp-yaml-skip-"));
    await writeFile(
      path.join(dir, "settings.yaml"),
      "mcp:\n  allowConnect: true\n  servers:\n    - serverName: from-yaml\n      command: npx\n",
      "utf8",
    );
    const rt = runtime(dir);
    // createFaceRuntime already hydrated; mcp should come from yaml migrate
    // only when host-settings is missing — which triggers migrate into Face.
    expect(rt.settingsNamespaces.ensure("mcp").user.servers).toEqual([
      { serverName: "from-yaml", command: "npx" },
    ]);
    expect(rt.settingsNamespaces.ensure("mcp").user.allowConnect).toBe(true);
    // Migrated dump must exist so Host boot can read the same SoT.
    const dump = await readFile(path.join(dir, "host-settings.json"), "utf8");
    expect(dump).toContain("from-yaml");
  });

  it("persistHostSettings refuses to overwrite unparsable host-settings.json", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-host-persist-refuse-"));
    const file = path.join(dir, "host-settings.json");
    await writeFile(
      file,
      `${JSON.stringify({
        mcp: {
          servers: [{ serverName: "demo", command: "npx" }],
          allowConnect: true,
        },
      })}\n`,
      "utf8",
    );
    const rt = runtime(dir);
    hydrateFaceHostSettings(rt);
    await writeFile(file, "{ broken", "utf8");
    const mut = await dispatchFaceMethod(rt, "settings.mutate", "m-mcp", {
      ns: "mcp",
      ops: [{ op: "set", path: ["allowConnect"], value: false }],
    });
    expect(mut.result.ok).toBe(false);
    if (!mut.result.ok) {
      expect(mut.result.error.message).toMatch(/unparsable|refusing to overwrite/i);
    }
    expect(await readFile(file, "utf8")).toContain("{ broken");
  });
});
