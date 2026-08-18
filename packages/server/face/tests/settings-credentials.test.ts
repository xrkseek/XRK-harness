import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  effectiveHostApiKey,
  listCredentialSlots,
} from "../src/settings-credentials.js";
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

function runtime(opts?: {
  bootstrapApiKey?: string;
  hostPublic?: boolean;
  productDir?: string;
  settingsDocumentPath?: string;
  openNativePath?: (target: string) => Promise<void>;
  plugins?: Parameters<typeof createFaceRuntime>[0]["plugins"];
}) {
  const store = createMemorySessionStore();
  return createFaceRuntime({
    store,
    workspaceRoot: opts?.productDir ?? process.cwd(),
    drain: drain(),
    resolveAgent: async () => {
      throw new Error("unused");
    },
    ...(opts?.productDir !== undefined ? { productDir: opts.productDir } : {}),
    ...(opts?.settingsDocumentPath !== undefined
      ? { settingsDocumentPath: opts.settingsDocumentPath }
      : {}),
    ...(opts?.openNativePath !== undefined
      ? { openNativePath: opts.openNativePath }
      : {}),
    ...(opts?.bootstrapApiKey !== undefined
      ? { bootstrapApiKey: opts.bootstrapApiKey }
      : {}),
    ...(opts?.plugins !== undefined ? { plugins: opts.plugins } : {}),
    ...(opts?.hostPublic
      ? {
          hostPublic: {
            host: "127.0.0.1",
            port: 8787,
            workspaceRoot: process.cwd(),
            preset: "minimal",
            corsOrigin: "*",
            rateLimitPerMinute: 120,
            webDistConfigured: false,
          },
        }
      : {}),
  });
}

describe("Face settings U2", () => {
  it("get returns ui · host · llm scopes; set ui only", async () => {
    const rt = runtime({ hostPublic: true });
    const all = await dispatchFaceMethod(rt, "settings.get", "g1", {});
    expect(all.result.ok).toBe(true);
    if (all.result.ok) {
      const v = all.result.value as {
        scopes: { id: string; writable: boolean }[];
        values: {
          ui: { theme: string; locale: string };
          host: { port: number } | null;
        };
      };
      expect(v.scopes.map((s) => s.id).sort()).toEqual(["host", "llm", "ui"]);
      expect(v.scopes.find((s) => s.id === "ui")?.writable).toBe(true);
      expect(v.scopes.find((s) => s.id === "host")?.writable).toBe(false);
      expect(v.values.ui.theme).toBe("system");
      expect(v.values.host?.port).toBe(8787);
    }

    const setUi = await dispatchFaceMethod(rt, "settings.set", "s1", {
      scope: "ui",
      patch: { theme: "dark", locale: "zh-CN" },
    });
    expect(setUi.result.ok).toBe(true);
    if (setUi.result.ok) {
      expect(setUi.result.value).toMatchObject({
        scope: "ui",
        values: { theme: "dark", locale: "zh-CN" },
      });
    }

    const scoped = await dispatchFaceMethod(rt, "settings.get", "g2", {
      scope: "ui",
    });
    expect(scoped.result.ok).toBe(true);
    if (scoped.result.ok) {
      const v = scoped.result.value as {
        values: { ui: { theme: string; locale: string } };
      };
      expect(v.values.ui).toEqual({ theme: "dark", locale: "zh-CN" });
    }

    const badTheme = await dispatchFaceMethod(rt, "settings.set", "s2", {
      scope: "ui",
      patch: { theme: "neon" },
    });
    expect(badTheme.result.ok).toBe(false);
    if (!badTheme.result.ok) {
      expect(badTheme.result.error.code).toBe("settings-rejected");
    }

    const readonlyHost = await dispatchFaceMethod(rt, "settings.set", "s3", {
      scope: "host",
      patch: { port: 1 },
    });
    expect(readonlyHost.result.ok).toBe(false);
    if (!readonlyHost.result.ok) {
      expect(readonlyHost.result.error.code).toBe("settings-rejected");
    }
  });

  it("DSH describe/mutate supports ui-onboarding welcome ack", async () => {
    const rt = runtime({ hostPublic: true });
    const desc = await dispatchFaceMethod(rt, "settings.describe", "d1", {});
    expect(desc.result.ok).toBe(true);
    if (!desc.result.ok) return;
    const v = desc.result.value as {
      writable: boolean;
      namespaces: { ns: string; value: unknown }[];
    };
    expect(v.writable).toBe(true);
    expect(
      (desc.result.value as { hasDocument: boolean }).hasDocument,
    ).toBe(true);
    expect(v.namespaces.some((n) => n.ns === "ui-onboarding")).toBe(true);
    expect(v.namespaces.some((n) => n.ns === "locale")).toBe(true);
    expect(v.namespaces.some((n) => n.ns === "ui-theme")).toBe(true);
    expect(v.namespaces.some((n) => n.ns === "permission")).toBe(true);
    expect(v.namespaces.some((n) => n.ns === "llm")).toBe(true);
    expect(v.namespaces.some((n) => n.ns === "mcp")).toBe(true);

    const permission = v.namespaces.find((n) => n.ns === "permission") as {
      ns: string;
      value: { defaultPreset: string };
      schema: { uid: number; refs: Record<string, { type: string }> };
    };
    expect(permission.value.defaultPreset).toBe("workspace-write");
    expect(permission.schema.uid).toBe(5);
    expect(permission.schema.refs["5"]?.type).toBe("object");

    const locale = (
      desc.result.value as {
        namespaces: { ns: string; schema: { uid: number } }[];
      }
    ).namespaces.find((n) => n.ns === "locale");
    expect(locale?.schema.uid).toBe(4);

    const mut = await dispatchFaceMethod(rt, "settings.mutate", "d2", {
      ns: "ui-onboarding",
      ops: [
        {
          op: "set",
          path: ["welcomeNoticeVersion"],
          value: "2026-08-17.xrk1",
        },
      ],
    });
    expect(mut.result.ok).toBe(true);
    if (!mut.result.ok) return;
    expect(mut.result.value).toMatchObject({
      ns: "ui-onboarding",
      value: { welcomeNoticeVersion: "2026-08-17.xrk1" },
    });

    const again = await dispatchFaceMethod(rt, "settings.describe", "d3", {});
    expect(again.result.ok).toBe(true);
    if (!again.result.ok) return;
    const ns = (
      again.result.value as {
        namespaces: { ns: string; value: Record<string, unknown> }[];
      }
    ).namespaces.find((n) => n.ns === "ui-onboarding");
    expect(ns?.value.welcomeNoticeVersion).toBe("2026-08-17.xrk1");
  });

  it("permission mutate keeps schemastery envelope; rejects unknown preset", async () => {
    const rt = runtime();
    await dispatchFaceMethod(rt, "settings.describe", "pd", {});
    const mut = await dispatchFaceMethod(rt, "settings.mutate", "pm", {
      ns: "permission",
      ops: [
        {
          op: "set",
          path: ["defaultPreset"],
          value: "workspace-write",
        },
      ],
    });
    expect(mut.result.ok).toBe(true);
    if (!mut.result.ok) return;
    expect(mut.result.value).toMatchObject({
      ns: "permission",
      value: { defaultPreset: "workspace-write" },
      schema: { uid: 5 },
    });

    const bad = await dispatchFaceMethod(rt, "settings.mutate", "pb", {
      ns: "permission",
      ops: [{ op: "set", path: ["defaultPreset"], value: "yolo" }],
    });
    expect(bad.result.ok).toBe(false);
    if (!bad.result.ok) {
      expect(bad.result.error.code).toBe("settings-rejected");
    }
  });

  it("describe lists MCP connected overlay; mutate persists desired servers", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-mcp-settings-"));
    const rt = runtime({
      productDir: dir,
      plugins: [
        {
          id: "mcp:demo",
          kind: "tools",
          tools: [],
        },
        { id: "example-tools", kind: "tools" },
      ],
    });
    const desc = await dispatchFaceMethod(rt, "settings.describe", "md", {});
    expect(desc.result.ok).toBe(true);
    if (!desc.result.ok) return;
    const mcp = (
      desc.result.value as {
        namespaces: {
          ns: string;
          applies: string;
          value: {
            servers: unknown[];
            connected: { id: string; serverName: string; toolCount: number }[];
            note: string;
          };
        }[];
      }
    ).namespaces.find((n) => n.ns === "mcp");
    expect(mcp?.applies).toBe("restart");
    expect(mcp?.value.servers).toEqual([]);
    expect(mcp?.value.connected).toEqual([
      {
        id: "mcp:demo",
        serverName: "demo",
        kind: "tools",
        toolCount: 0,
      },
    ]);
    expect(mcp?.value.note).toContain("host-settings.json");

    const draft = [
      { serverName: "fs", command: "npx", args: ["-y", "mcp-server"] },
    ];
    const mut = await dispatchFaceMethod(rt, "settings.mutate", "mm", {
      ns: "mcp",
      ops: [{ op: "set", path: ["servers"], value: draft }],
    });
    expect(mut.result.ok).toBe(true);
    if (!mut.result.ok) return;
    expect(mut.result.value).toMatchObject({
      ns: "mcp",
      applies: "restart",
      value: { servers: draft },
    });
    expect(
      (mut.result.value as { value: { connected: { id: string }[] } }).value
        .connected,
    ).toEqual([
      {
        id: "mcp:demo",
        serverName: "demo",
        kind: "tools",
        toolCount: 0,
      },
    ]);

    const dumped = JSON.parse(
      await readFile(path.join(dir, "host-settings.json"), "utf8"),
    ) as { mcp: { servers: unknown } };
    expect(dumped.mcp.servers).toEqual(draft);
    expect(JSON.stringify(dumped)).not.toContain('"env"');

    const reloaded = runtime({ productDir: dir });
    const again = await dispatchFaceMethod(reloaded, "settings.describe", "md2", {});
    expect(again.result.ok).toBe(true);
    if (!again.result.ok) return;
    const hydrated = (
      again.result.value as {
        namespaces: { ns: string; value: { servers: unknown[] } }[];
      }
    ).namespaces.find((n) => n.ns === "mcp");
    expect(hydrated?.value.servers).toEqual(draft);

    const withEnv = await dispatchFaceMethod(rt, "settings.mutate", "me", {
      ns: "mcp",
      ops: [
        {
          op: "set",
          path: ["servers"],
          value: [{ serverName: "x", command: "npx", env: { TOKEN: "secret" } }],
        },
      ],
    });
    expect(withEnv.result.ok).toBe(false);
    if (!withEnv.result.ok) {
      expect(withEnv.result.error.code).toBe("settings-rejected");
    }

    const overlay = await dispatchFaceMethod(rt, "settings.mutate", "mc", {
      ns: "mcp",
      ops: [{ op: "set", path: ["connected"], value: [] }],
    });
    expect(overlay.result.ok).toBe(false);
    if (!overlay.result.ok) {
      expect(overlay.result.error.code).toBe("settings-rejected");
    }

    const invalid = await dispatchFaceMethod(rt, "settings.mutate", "mi", {
      ns: "mcp",
      ops: [
        {
          op: "set",
          path: ["servers"],
          value: [{ serverName: "x" }],
        },
      ],
    });
    expect(invalid.result.ok).toBe(false);
    if (!invalid.result.ok) {
      expect(invalid.result.error.code).toBe("settings-rejected");
    }
  });

  it("settings.replace replaces whole ns section", async () => {
    const rt = runtime({ hostPublic: true });
    const rep = await dispatchFaceMethod(rt, "settings.replace", "r1", {
      ns: "ui-onboarding",
      section: { welcomeNoticeVersion: "replaced.v1", extra: true },
    });
    expect(rep.result.ok).toBe(true);
    if (!rep.result.ok) return;
    expect(rep.result.value).toMatchObject({
      ns: "ui-onboarding",
      value: { welcomeNoticeVersion: "replaced.v1", extra: true },
    });
  });

  it("settings.openDocument ignores client paths and uses Host dump", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-settings-"));
    const opened: string[] = [];
    const rt = runtime({
      hostPublic: true,
      productDir: dir,
      openNativePath: async (target) => {
        opened.push(target);
      },
    });
    const openDoc = await dispatchFaceMethod(
      rt,
      "settings.openDocument",
      "od1",
      { path: "C:\\Windows\\System32\\drivers\\etc\\hosts" },
    );
    expect(openDoc.result.ok).toBe(true);
    if (openDoc.result.ok) {
      expect(openDoc.result.value).toEqual({ opened: true });
    }
    expect(opened).toHaveLength(1);
    expect(opened[0]).toBe(path.join(dir, "host-settings.json"));
    expect(opened[0]!.toLowerCase()).not.toContain("system32");
  });

  it("settings.openDocument prefers an existing policy file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-policy-"));
    const policy = path.join(dir, "policy.json");
    await writeFile(policy, "{}\n", "utf8");
    const opened: string[] = [];
    const rt = runtime({
      settingsDocumentPath: policy,
      productDir: dir,
      openNativePath: async (target) => {
        opened.push(target);
      },
    });
    const openDoc = await dispatchFaceMethod(rt, "settings.openDocument", "od2", {});
    expect(openDoc.result.ok).toBe(true);
    expect(opened).toEqual([policy]);
  });
});

describe("Face credentials U2", () => {
  it("list never leaks values; set/clear vault only", async () => {
    const rt = runtime({ bootstrapApiKey: "" });
    const listed = await dispatchFaceMethod(rt, "credentials.list", "c1", {});
    expect(listed.result.ok).toBe(true);
    if (listed.result.ok) {
      const v = listed.result.value as {
        slots: { id: string; configured: boolean; source: string }[];
        note: string;
      };
      expect(v.note).toMatch(/never returns secret/i);
      expect(JSON.stringify(v)).not.toContain("sk-");
      expect(v.slots.some((s) => s.id === "host.apiKey")).toBe(true);
      expect(v.slots.find((s) => s.id === "host.apiKey")?.configured).toBe(
        false,
      );
    }

    const set = await dispatchFaceMethod(rt, "credentials.set", "c2", {
      slotId: "host.apiKey",
      value: "secret-test-key",
    });
    expect(set.result.ok).toBe(true);
    if (set.result.ok) {
      const v = set.result.value as {
        configured: boolean;
        source: string;
      };
      expect(v.configured).toBe(true);
      expect(v.source).toBe("vault");
      expect(JSON.stringify(v)).not.toContain("secret-test-key");
    }

    expect(effectiveHostApiKey(rt)).toBe("secret-test-key");
    expect(rt.store.list()).toEqual([]);

    const clear = await dispatchFaceMethod(rt, "credentials.set", "c3", {
      slotId: "host.apiKey",
      clear: true,
    });
    expect(clear.result.ok).toBe(true);
    expect(effectiveHostApiKey(rt)).toBe("");

    const unknown = await dispatchFaceMethod(rt, "credentials.set", "c4", {
      slotId: "nope.key",
      value: "x",
    });
    expect(unknown.result.ok).toBe(false);
    if (!unknown.result.ok) {
      expect(unknown.result.error.code).toBe("credential-rejected");
    }
  });

  it("bootstrap key marks host slot configured", () => {
    const rt = runtime({ bootstrapApiKey: "from-config" });
    expect(effectiveHostApiKey(rt)).toBe("from-config");
    const host = listCredentialSlots(rt, {}).find((s) => s.id === "host.apiKey");
    expect(host?.configured).toBe(true);
    expect(host?.source).toBe("env");
  });

  it("DSH credentials.describe + set by ref/env", async () => {
    const rt = runtime({ bootstrapApiKey: "" });
    const desc = await dispatchFaceMethod(rt, "credentials.describe", "cd1", {
      refs: ["host.apiKey", "XRK_API_KEY", "unknown.ref"],
    });
    expect(desc.result.ok).toBe(true);
    if (!desc.result.ok) return;
    const v = desc.result.value as {
      credentials: Record<
        string,
        { configured: boolean; writable: boolean; source?: string }
      >;
    };
    expect(v.credentials["host.apiKey"]?.configured).toBe(false);
    expect(v.credentials["host.apiKey"]?.writable).toBe(true);
    expect(v.credentials["XRK_API_KEY"]?.configured).toBe(false);
    expect(v.credentials["unknown.ref"]).toEqual({
      configured: false,
      writable: true,
    });
    expect(JSON.stringify(v)).not.toMatch(/sk-|secret/i);

    const setByEnv = await dispatchFaceMethod(rt, "credentials.set", "cd2", {
      ref: "XRK_API_KEY",
      value: "via-env-ref",
    });
    expect(setByEnv.result.ok).toBe(true);
    expect(effectiveHostApiKey(rt)).toBe("via-env-ref");

    const again = await dispatchFaceMethod(rt, "credentials.describe", "cd3", {
      refs: ["XRK_API_KEY"],
    });
    expect(again.result.ok).toBe(true);
    if (!again.result.ok) return;
    const creds = (
      again.result.value as {
        credentials: Record<string, { configured: boolean; source?: string }>;
      }
    ).credentials;
    expect(creds["XRK_API_KEY"]?.configured).toBe(true);
    expect(creds["XRK_API_KEY"]?.source).toBe("vault");

    const unset = await dispatchFaceMethod(rt, "credentials.unset", "cd4", {
      ref: "XRK_API_KEY",
    });
    expect(unset.result.ok).toBe(true);
    if (unset.result.ok) {
      expect(unset.result.value).toEqual({});
    }
    expect(effectiveHostApiKey(rt)).toBe("");
  });
});
