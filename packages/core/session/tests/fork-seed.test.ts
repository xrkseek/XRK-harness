import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildForkSeed,
  createMemorySessionStore,
  createPersistentSessionStore,
  forkSession,
} from "../src/index.js";

const dirs: string[] = [];
const openStores: Array<{ close(): void }> = [];

afterEach(() => {
  while (openStores.length > 0) {
    openStores.pop()!.close();
  }
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe("fork seed (DSH end-seed + forked)", () => {
  it("appends session/end-seed and closes an open turn with forked", () => {
    const seed = buildForkSeed(
      [
        { type: "turn/start", ts: 1, turnId: "t1" },
        {
          type: "user/message",
          ts: 2,
          turnId: "t1",
          content: "hi",
        },
      ],
      () => 99,
    );
    expect(seed.at(-1)).toEqual({
      type: "session/end-seed",
      ts: 99,
      inherited: true,
    });
    expect(seed.some((e) => e.type === "turn/end" && e.reason.kind === "forked")).toBe(
      true,
    );
  });

  it("forkSession persists the inheritance marker", () => {
    const store = createMemorySessionStore();
    const parent = store.create("p");
    store.append(parent.id, { type: "turn/start", ts: 1, turnId: "t1" });
    store.append(parent.id, {
      type: "turn/end",
      ts: 2,
      turnId: "t1",
      reason: { kind: "completed" },
    });
    const child = forkSession(store, parent.id, undefined, "c");
    const events = store.readEvents(child.id);
    expect(events.at(-1)?.type).toBe("session/end-seed");
    expect(events).toHaveLength(3);
  });

  it("sqlite seedFromSession copies prefix via SQL and appends end-seed", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-fork-sql-"));
    dirs.push(dir);
    const store = createPersistentSessionStore(dir);
    openStores.push(store);
    const parent = store.create("parent").id;
    for (let i = 0; i < 8; i++) {
      store.append(parent, {
        type: "turn/start",
        ts: i * 2 + 1,
        turnId: `t${i}`,
      });
      store.append(parent, {
        type: "turn/end",
        ts: i * 2 + 2,
        turnId: `t${i}`,
        reason: { kind: "completed" },
      });
    }
    store.flush();
    expect(typeof store.seedFromSession).toBe("function");

    const child = forkSession(store, parent, 4, "child");
    expect(child.events).toHaveLength(5); // 4 prefix + end-seed
    expect(child.events.at(-1)?.type).toBe("session/end-seed");
    expect(child.events[0]).toEqual(store.get(parent).events[0]);
    expect(store.get(parent).events).toHaveLength(16);

    store.close();
    openStores.pop();
    const reloaded = createPersistentSessionStore(dir);
    openStores.push(reloaded);
    expect(reloaded.get("child").events).toHaveLength(5);
    expect(reloaded.get("child").events.at(-1)?.type).toBe("session/end-seed");
  });
});
