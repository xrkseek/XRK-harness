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
}) {
  const store = createMemorySessionStore();
  return createFaceRuntime({
    store,
    workspaceRoot: process.cwd(),
    drain: drain(),
    resolveAgent: async () => {
      throw new Error("unused");
    },
    ...(opts?.bootstrapApiKey !== undefined
      ? { bootstrapApiKey: opts.bootstrapApiKey }
      : {}),
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
      expect(badTheme.result.error.code).toBe("settings-invalid");
    }

    const readonlyHost = await dispatchFaceMethod(rt, "settings.set", "s3", {
      scope: "host",
      patch: { port: 1 },
    });
    expect(readonlyHost.result.ok).toBe(false);
    if (!readonlyHost.result.ok) {
      expect(readonlyHost.result.error.code).toBe("settings-readonly");
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
    expect(v.namespaces.some((n) => n.ns === "ui-onboarding")).toBe(true);

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

    const openDoc = await dispatchFaceMethod(
      rt,
      "settings.openDocument",
      "od1",
      {},
    );
    expect(openDoc.result.ok).toBe(false);
    if (!openDoc.result.ok) {
      expect(openDoc.result.error.code).toBe("not-implemented");
    }
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
      expect(unknown.result.error.code).toBe("credentials-slot-not-found");
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
