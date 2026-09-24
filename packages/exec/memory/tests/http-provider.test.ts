/**
 * HTTP MemoryProvider sample — in-memory sidecar mock.
 */
import { describe, expect, it } from "vitest";
import {
  createFileMemoryProvider,
  createHttpMemoryProvider,
  probeHttpMemoryProvider,
  resolveMemoryProvider,
  type CuratedMemoryOperation,
  type CuratedMemoryTarget,
} from "../src/index.js";

function mockSidecar() {
  const store: Record<CuratedMemoryTarget, string[]> = {
    memory: ["prefers tabs"],
    user: [],
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.endsWith("/health") && method === "GET") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const getMatch = /\/v1\/curated\/(memory|user)$/.exec(url);
    if (getMatch && method === "GET") {
      const target = getMatch[1] as CuratedMemoryTarget;
      return new Response(JSON.stringify({ entries: store[target] }), {
        status: 200,
      });
    }
    const opsMatch = /\/v1\/curated\/(memory|user)\/ops$/.exec(url);
    if (opsMatch && method === "POST") {
      const target = opsMatch[1] as CuratedMemoryTarget;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        operations?: CuratedMemoryOperation[];
      };
      const ops = body.operations ?? [];
      let entries = [...store[target]];
      for (const op of ops) {
        const action = String(op.action ?? "");
        const content = String(op.content ?? op.new_text ?? "").trim();
        const oldText = String(op.old_text ?? "");
        if (action === "add" && content) entries.push(content);
        if (action === "remove" && oldText) {
          entries = entries.filter((e) => !e.includes(oldText));
        }
        if (action === "replace" && oldText && content) {
          entries = entries.map((e) => (e.includes(oldText) ? content : e));
        }
      }
      store[target] = entries;
      return new Response(
        JSON.stringify({
          success: true,
          message: "Entry added.",
          target,
          current_entries: entries,
          entry_count: entries.length,
        }),
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  };

  return { store, fetchImpl };
}

describe("MemoryProvider HTTP sample", () => {
  it("freezes remote entries and writes through /ops", async () => {
    const { store, fetchImpl } = mockSidecar();
    const provider = await createHttpMemoryProvider({
      baseUrl: "http://memory.test",
      fetchImpl,
      token: "secret",
    });
    expect(provider.providerName).toBe("http");
    expect(await provider.isAvailable()).toBe(true);
    expect(provider.frozenPrompt("memory")).toContain("prefers tabs");
    expect(provider.frozenSystemBlock()).toContain("prefers tabs");

    const added = await Promise.resolve(
      provider.add("memory", "ship on Fridays"),
    );
    expect(added.success).toBe(true);
    expect(store.memory).toContain("ship on Fridays");
    // Frozen snapshot unchanged (same as file provider).
    expect(provider.frozenPrompt("memory")).toContain("prefers tabs");
    expect(provider.frozenPrompt("memory")).not.toContain("ship on Fridays");
    expect(await Promise.resolve(provider.listEntries("memory"))).toEqual([
      "prefers tabs",
      "ship on Fridays",
    ]);
  });

  it("probeHttpMemoryProvider hits /health only", async () => {
    let hits = 0;
    const fetchImpl: typeof fetch = async (input) => {
      hits += 1;
      expect(String(input)).toContain("/health");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    expect(
      await probeHttpMemoryProvider({
        baseUrl: "http://memory.test",
        fetchImpl,
      }),
    ).toBe(true);
    expect(hits).toBe(1);
  });

  it("resolveMemoryProvider defaults to file; http needs URL", async () => {
    const file = await resolveMemoryProvider({ kind: "file" });
    expect(file.providerName).toBe("file");
    expect(createFileMemoryProvider().providerName).toBe("file");

    await expect(
      resolveMemoryProvider({
        kind: "http",
        env: {},
      }),
    ).rejects.toThrow(/XRK_MEMORY_HTTP_URL/);

    const { fetchImpl } = mockSidecar();
    const http = await resolveMemoryProvider({
      kind: "http",
      http: { baseUrl: "http://memory.test", fetchImpl },
    });
    expect(http.providerName).toBe("http");
  });
});
