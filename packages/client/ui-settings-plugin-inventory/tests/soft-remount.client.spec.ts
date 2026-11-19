import { describe, expect, it, vi } from "vitest";
import {
  applyOverlayBootPlan,
  ensureOverlayUrlRev,
  overlayRevMap,
  planOverlayRemount,
  softRemountClientOverlay,
  softUnloadClientOverlay,
} from "../src/client/soft-remount.ts";

describe("planOverlayRemount", () => {
  it("detects shrink when previous ids disappear", () => {
    const plan = planOverlayRemount(
      new Map([
        ["a", "1"],
        ["b", "1"],
      ]),
      {
        rev: "r2",
        entries: [{ id: "a", url: "/plugins/a/client.js?rev=1", rev: "1" }],
      },
    );
    expect(plan).toEqual({ removed: ["b"], delta: [] });
  });

  it("plans delta for new ids only", () => {
    const overlay = {
      rev: "r3",
      entries: [
        { id: "a", url: "/plugins/a/client.js?rev=1", rev: "1" },
        { id: "c", url: "/plugins/c/client.js?rev=1", rev: "1" },
      ],
    };
    const plan = planOverlayRemount(new Map([["a", "1"]]), overlay);
    expect(plan.removed).toEqual([]);
    expect(plan.delta.map((e) => e.id)).toEqual(["c"]);
  });

  it("plans delta when rev bumps", () => {
    const overlay = {
      rev: "r4",
      entries: [{ id: "a", url: "/plugins/a/client.js?rev=2", rev: "2" }],
    };
    const plan = planOverlayRemount(new Map([["a", "1"]]), overlay);
    expect(plan.removed).toEqual([]);
    expect(plan.delta).toHaveLength(1);
    expect(plan.delta[0]?.rev).toBe("2");
  });

  it("returns empty removed+delta when unchanged", () => {
    const overlay = {
      rev: "r5",
      entries: [{ id: "a", url: "/plugins/a/client.js?rev=1", rev: "1" }],
    };
    expect(planOverlayRemount(new Map([["a", "1"]]), overlay)).toEqual({
      removed: [],
      delta: [],
    });
  });

  it("reports shrink and delta together (delete A + install B)", () => {
    const plan = planOverlayRemount(new Map([["a", "1"]]), {
      rev: "r6",
      entries: [{ id: "b", url: "/plugins/b/client.js?rev=1", rev: "1" }],
    });
    expect(plan.removed).toEqual(["a"]);
    expect(plan.delta.map((e) => e.id)).toEqual(["b"]);
  });
});

describe("overlayRevMap", () => {
  it("maps id to rev", () => {
    expect(
      overlayRevMap({
        rev: "r",
        entries: [
          { id: "a", url: "/a", rev: "1" },
          { id: "b", url: "/b", rev: "2" },
        ],
      }),
    ).toEqual(
      new Map([
        ["a", "1"],
        ["b", "2"],
      ]),
    );
  });
});

describe("ensureOverlayUrlRev", () => {
  it("appends ?rev= when missing", () => {
    expect(ensureOverlayUrlRev("/plugins/a/client.js", "1.2.3")).toBe(
      "/plugins/a/client.js?rev=1.2.3",
    );
  });

  it("replaces a stale rev query", () => {
    expect(ensureOverlayUrlRev("/plugins/a/client.js?rev=9", "1")).toBe(
      "/plugins/a/client.js?rev=1",
    );
  });
});

describe("softRemountClientOverlay", () => {
  it("returns all failed when modules/loader are missing", async () => {
    const ctx = {
      get: () => undefined,
    };
    const result = await softRemountClientOverlay(ctx as never, {
      rev: "r1",
      entries: [
        { id: "a", url: "/plugins/a/client.js", rev: "1" },
        { id: "b", url: "/plugins/b/client.js", rev: "1" },
      ],
    });
    expect(result).toEqual({ mounted: [], failed: ["a", "b"] });
  });

  it("adopts + creates missing overlay entries with cache-bust url", async () => {
    const adopt = vi.fn();
    const prefetch = vi.fn(async () => undefined);
    const fiber = { await: vi.fn(async () => undefined) };
    const entry = { fiber };
    const loader = {
      entries: () => [],
      create: vi.fn(async () => "entry-a"),
      resolve: vi.fn(() => entry),
    };
    const ctx = {
      get: (name: string) => {
        if (name === "modules") {
          return { adopt, prefetch, invalidate: vi.fn() };
        }
        if (name === "loader") return loader;
        return undefined;
      },
    };

    const result = await softRemountClientOverlay(ctx as never, {
      rev: "r2",
      entries: [{ id: "pkg-a", url: "/plugins/pkg-a/client.js", rev: "2" }],
    });

    expect(adopt).toHaveBeenCalledWith({
      id: "pkg-a",
      url: "/plugins/pkg-a/client.js?rev=2",
      rev: "2",
    });
    expect(prefetch).toHaveBeenCalledWith("pkg-a");
    expect(loader.create).toHaveBeenCalledWith({ name: "pkg-a" });
    expect(fiber.await).toHaveBeenCalled();
    expect(result).toEqual({ mounted: ["pkg-a"], failed: [] });
  });

  it("only remounts delta rows when provided", async () => {
    const adopt = vi.fn();
    const prefetch = vi.fn(async () => undefined);
    const fiber = { await: vi.fn(async () => undefined) };
    const entry = { fiber };
    const loader = {
      entries: () => [],
      create: vi.fn(async () => "entry-b"),
      resolve: vi.fn(() => entry),
    };
    const ctx = {
      get: (name: string) => {
        if (name === "modules") {
          return { adopt, prefetch, invalidate: vi.fn() };
        }
        if (name === "loader") return loader;
        return undefined;
      },
    };

    const overlay = {
      rev: "r",
      entries: [
        { id: "pkg-a", url: "/plugins/pkg-a/client.js", rev: "1" },
        { id: "pkg-b", url: "/plugins/pkg-b/client.js", rev: "1" },
      ],
    };
    const result = await softRemountClientOverlay(ctx as never, overlay, [
      overlay.entries[1]!,
    ]);
    expect(adopt).toHaveBeenCalledTimes(1);
    expect(adopt).toHaveBeenCalledWith({
      id: "pkg-b",
      url: "/plugins/pkg-b/client.js?rev=1",
      rev: "1",
    });
    expect(result).toEqual({ mounted: ["pkg-b"], failed: [] });
  });

  it("reloads already-mounted overlay entries", async () => {
    const invalidate = vi.fn();
    const prefetch = vi.fn(async () => undefined);
    const adopt = vi.fn();
    const refresh = vi.fn(async () => undefined);
    const fiberAwait = vi.fn(async () => undefined);
    const existing = {
      options: { name: "pkg-a" },
      fiber: {
        runtime: null,
        await: fiberAwait,
      },
      refresh,
      ctx: { registry: { delete: vi.fn() } },
    };
    // After refresh(), soft-remount expects a live fiber.
    refresh.mockImplementation(async () => {
      existing.fiber = { runtime: null, await: fiberAwait };
    });
    const loader = {
      entries: () => [existing],
      create: vi.fn(),
      resolve: vi.fn(),
    };
    const ctx = {
      get: (name: string) => {
        if (name === "modules") {
          return { adopt, prefetch, invalidate };
        }
        if (name === "loader") return loader;
        return undefined;
      },
    };

    const prevDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        querySelectorAll: () => [],
      },
    });

    try {
      const result = await softRemountClientOverlay(ctx as never, {
        rev: "r3",
        entries: [{ id: "pkg-a", url: "/plugins/pkg-a/client.js", rev: "3" }],
      });
      expect(adopt).toHaveBeenCalledWith({
        id: "pkg-a",
        url: "/plugins/pkg-a/client.js?rev=3",
        rev: "3",
      });
      expect(invalidate).toHaveBeenCalledWith("pkg-a");
      expect(prefetch).toHaveBeenCalledWith("pkg-a");
      expect(refresh).toHaveBeenCalled();
      expect(loader.create).not.toHaveBeenCalled();
      expect(result).toEqual({ mounted: ["pkg-a"], failed: [] });
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: prevDocument,
      });
    }
  });

  it("marks reload as failed when refresh leaves no fiber", async () => {
    const existing = {
      options: { name: "pkg-a" },
      fiber: {
        runtime: null,
        await: vi.fn(async () => undefined),
      },
      refresh: vi.fn(async () => {
        delete (existing as { fiber?: unknown }).fiber;
      }),
      ctx: { registry: { delete: vi.fn() } },
    };
    const loader = {
      entries: () => [existing],
      create: vi.fn(),
      resolve: vi.fn(),
    };
    const ctx = {
      get: (name: string) => {
        if (name === "modules") {
          return {
            adopt: vi.fn(),
            prefetch: vi.fn(async () => undefined),
            invalidate: vi.fn(),
          };
        }
        if (name === "loader") return loader;
        return undefined;
      },
    };
    const prevDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { querySelectorAll: () => [] },
    });
    try {
      const result = await softRemountClientOverlay(ctx as never, {
        rev: "r",
        entries: [{ id: "pkg-a", url: "/plugins/pkg-a/client.js", rev: "1" }],
      });
      expect(result).toEqual({ mounted: [], failed: ["pkg-a"] });
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: prevDocument,
      });
    }
  });
});

describe("softUnloadClientOverlay", () => {
  it("returns all failed when modules/loader are missing", async () => {
    const result = await softUnloadClientOverlay(
      { get: () => undefined } as never,
      ["a", "b"],
    );
    expect(result).toEqual({ unloaded: [], failed: ["a", "b"] });
  });

  it("invalidates missing entries without calling loader.remove", async () => {
    const invalidate = vi.fn();
    const remove = vi.fn();
    const ctx = {
      get: (name: string) => {
        if (name === "modules") return { invalidate };
        if (name === "loader") {
          return { entries: () => [], remove };
        }
        return undefined;
      },
    };
    const prevDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { querySelectorAll: () => [] },
    });
    try {
      const result = await softUnloadClientOverlay(ctx as never, ["gone"]);
      expect(invalidate).toHaveBeenCalledWith("gone");
      expect(remove).not.toHaveBeenCalled();
      expect(result).toEqual({ unloaded: ["gone"], failed: [] });
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: prevDocument,
      });
    }
  });

  it("removes mounted entries in reverse order via loader.remove", async () => {
    const invalidate = vi.fn();
    const remove = vi.fn(async () => undefined);
    const entries = [
      { options: { id: "entry-a", name: "pkg-a" } },
      { options: { id: "entry-b", name: "pkg-b" } },
    ];
    const ctx = {
      get: (name: string) => {
        if (name === "modules") return { invalidate };
        if (name === "loader") {
          return { entries: () => entries, remove };
        }
        return undefined;
      },
    };
    const removedStyles: string[] = [];
    const prevDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        querySelectorAll: () => [
          {
            getAttribute: (k: string) => (k === "data-plugin" ? "pkg-b" : null),
            remove: () => removedStyles.push("pkg-b"),
          },
        ],
      },
    });
    try {
      const result = await softUnloadClientOverlay(ctx as never, [
        "pkg-a",
        "pkg-b",
      ]);
      expect(remove.mock.calls.map((c) => c[0])).toEqual([
        "entry-b",
        "entry-a",
      ]);
      expect(invalidate).toHaveBeenCalledWith("pkg-b");
      expect(invalidate).toHaveBeenCalledWith("pkg-a");
      expect(removedStyles).toContain("pkg-b");
      expect(result).toEqual({ unloaded: ["pkg-b", "pkg-a"], failed: [] });
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: prevDocument,
      });
    }
  });

  it("records failed ids when loader.remove throws", async () => {
    const invalidate = vi.fn();
    const existing = { options: { id: "entry-a", name: "pkg-a" } };
    const ctx = {
      get: (name: string) => {
        if (name === "modules") return { invalidate };
        if (name === "loader") {
          return {
            entries: () => [existing],
            remove: vi.fn(async () => {
              throw new Error("boom");
            }),
          };
        }
        return undefined;
      },
    };
    const result = await softUnloadClientOverlay(ctx as never, ["pkg-a"]);
    expect(invalidate).not.toHaveBeenCalled();
    expect(result).toEqual({ unloaded: [], failed: ["pkg-a"] });
  });
});

describe("applyOverlayBootPlan", () => {
  it("keeps failed unload ids in lastRevs and sets unloadPending", async () => {
    const existing = { options: { id: "entry-a", name: "pkg-a" } };
    const ctx = {
      get: (name: string) => {
        if (name === "modules") return { invalidate: vi.fn() };
        if (name === "loader") {
          return {
            entries: () => [existing],
            remove: vi.fn(async () => {
              throw new Error("boom");
            }),
          };
        }
        return undefined;
      },
    };
    const session = {
      lastRevs: new Map([["pkg-a", "1"]]),
      unloadPending: false,
    };
    const result = await applyOverlayBootPlan(ctx as never, session, {
      rev: "r",
      entries: [],
    });
    expect(result).toEqual({ unloadFailed: true, remountFailed: false });
    expect(session.unloadPending).toBe(true);
    expect(session.lastRevs.get("pkg-a")).toBe("1");
  });

  it("drops successful unload ids and clears unloadPending", async () => {
    const ctx = {
      get: (name: string) => {
        if (name === "modules") return { invalidate: vi.fn() };
        if (name === "loader") {
          return { entries: () => [], remove: vi.fn() };
        }
        return undefined;
      },
    };
    const prevDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { querySelectorAll: () => [] },
    });
    try {
      const session = {
        lastRevs: new Map([["pkg-a", "1"]]),
        unloadPending: true,
      };
      const result = await applyOverlayBootPlan(ctx as never, session, {
        rev: "r",
        entries: [],
      });
      expect(result).toEqual({ unloadFailed: false, remountFailed: false });
      expect(session.unloadPending).toBe(false);
      expect(session.lastRevs.has("pkg-a")).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: prevDocument,
      });
    }
  });

  it("clears sticky unloadPending when Host restores the id (re-enable)", async () => {
    const ctx = {
      get: () => undefined,
    };
    const session = {
      lastRevs: new Map([["pkg-a", "1"]]),
      unloadPending: true,
    };
    const result = await applyOverlayBootPlan(ctx as never, session, {
      rev: "r",
      entries: [{ id: "pkg-a", url: "/plugins/pkg-a/client.js?rev=1", rev: "1" }],
    });
    expect(result).toEqual({ unloadFailed: false, remountFailed: false });
    expect(session.unloadPending).toBe(false);
    expect(session.lastRevs.get("pkg-a")).toBe("1");
  });

  it("retries remount only for failed delta rows", async () => {
    const adopt = vi.fn();
    const prefetch = vi.fn(async () => undefined);
    const fiber = { await: vi.fn(async () => undefined) };
    const entry = { fiber };
    const loader = {
      entries: () => [],
      create: vi.fn(async (opts: { name: string }) => {
        if (opts.name === "pkg-b") throw new Error("create failed");
        return `entry-${opts.name}`;
      }),
      resolve: vi.fn(() => entry),
    };
    const ctx = {
      get: (name: string) => {
        if (name === "modules") {
          return { adopt, prefetch, invalidate: vi.fn() };
        }
        if (name === "loader") return loader;
        return undefined;
      },
    };
    const session = {
      lastRevs: new Map<string, string>(),
      unloadPending: false,
    };
    const overlay = {
      rev: "r",
      entries: [
        { id: "pkg-a", url: "/plugins/pkg-a/client.js", rev: "1" },
        { id: "pkg-b", url: "/plugins/pkg-b/client.js", rev: "1" },
      ],
    };
    const first = await applyOverlayBootPlan(ctx as never, session, overlay);
    expect(first.remountFailed).toBe(true);
    expect(session.lastRevs.get("pkg-a")).toBe("1");
    expect(session.lastRevs.has("pkg-b")).toBe(false);

    loader.create = vi.fn(async (opts: { name: string }) => `entry-${opts.name}`);
    const second = await applyOverlayBootPlan(ctx as never, session, overlay);
    expect(second).toEqual({ unloadFailed: false, remountFailed: false });
    expect(session.lastRevs.get("pkg-b")).toBe("1");
    expect(loader.create).toHaveBeenCalledTimes(1);
    expect(loader.create).toHaveBeenCalledWith({ name: "pkg-b" });
  });
});
