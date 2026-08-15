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
});
