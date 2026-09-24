import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  InvariantError,
  createInvariantRegistry,
  replaySessionLog,
  resolveInvariantsFailFast,
  wrapSessionStore,
} from "../src/index.js";

function memoryStore() {
  const sessions = new Map<string, SessionEvent[]>();
  return {
    create(id = "s1") {
      sessions.set(id, []);
      return { id, events: sessions.get(id)! };
    },
    get(id: string) {
      const events = sessions.get(id);
      if (!events) throw new Error(`missing ${id}`);
      return { id, events };
    },
    has(id: string) {
      return sessions.has(id);
    },
    list() {
      return [...sessions.keys()];
    },
    append(id: string, event: SessionEvent) {
      const events = sessions.get(id);
      if (!events) throw new Error(`missing ${id}`);
      events.push(event);
      return event;
    },
  };
}

describe("runtime-invariants registry", () => {
  it("resolveInvariantsFailFast reads env truthy forms", () => {
    expect(resolveInvariantsFailFast({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      resolveInvariantsFailFast({ XRK_INVARIANTS_FAIL_FAST: "1" }),
    ).toBe(true);
    expect(
      resolveInvariantsFailFast({ XRK_INVARIANTS_FAIL_FAST: "true" }),
    ).toBe(true);
    expect(
      resolveInvariantsFailFast({ XRK_INVARIANTS_FAIL_FAST: "0" }),
    ).toBe(false);
  });

  it("attributes failures with stable code and packageName", () => {
    const registry = createInvariantRegistry();
    registry.register("@xrkseek/probe", (api, fail) => {
      api.onAppend(() => fail("seq must strictly increase"));
    });
    const store = wrapSessionStore(memoryStore(), registry);
    store.create("s1");
    let caught: unknown;
    try {
      store.append("s1", {
        type: "user/message",
        ts: 1,
        turnId: "t",
        content: "hi",
      } as SessionEvent);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvariantError);
    expect(caught).toMatchObject({
      code: "INVARIANT",
      packageName: "@xrkseek/probe",
    });
  });

  it("reserves ownership when disabled and skips listeners", () => {
    const registry = createInvariantRegistry({ enabled: false });
    const hits: string[] = [];
    registry.register("@xrkseek/probe", (api) => {
      api.onAppend(() => hits.push("x"));
    });
    expect(registry.has("@xrkseek/probe")).toBe(true);
    expect(() =>
      registry.register("@xrkseek/probe", () => {}),
    ).toThrow(/already registered/);
    const store = wrapSessionStore(memoryStore(), registry);
    store.create("s1");
    store.append("s1", {
      type: "user/message",
      ts: 1,
      turnId: "t",
      content: "hi",
    } as SessionEvent);
    expect(hits).toEqual([]);
  });

  it("blocklist overrides allowlist", () => {
    const registry = createInvariantRegistry({
      packageAllowlist: ["^@xrkseek/"],
      packageBlocklist: ["session"],
    });
    const hits: string[] = [];
    registry.register("@xrkseek/core-session", (api) => {
      api.onAppend(() => hits.push("session"));
    });
    registry.register("@xrkseek/core-agent-loop", (api) => {
      api.onAppend(() => hits.push("loop"));
    });
    replaySessionLog(registry, "s1", [
      { type: "user/message", ts: 1, turnId: "t", content: "hi" } as SessionEvent,
    ]);
    expect(hits).toEqual(["loop"]);
  });

  it("rejects malformed filter config", () => {
    expect(() =>
      createInvariantRegistry({ packageAllowlist: [""] }),
    ).toThrow(/non-blank/);
    expect(() =>
      createInvariantRegistry({ packageAllowlist: ["a", "a"] }),
    ).toThrow(/duplicate/);
    expect(() =>
      createInvariantRegistry({ packageAllowlist: ["["] }),
    ).toThrow(/invalid regex/);
  });
});
