import { describe, expect, it } from "vitest";
import {
  appendPluginRecord,
  createMemorySessionStore,
  deriveMessages,
  pluginRecordsOf,
} from "../src/index.js";

describe("plugin/record", () => {
  it("appends durable records and stays out of deriveMessages", () => {
    const store = createMemorySessionStore();
    const session = store.create("s1");
    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "hi",
    });
    appendPluginRecord(store, session.id, "git-worktrees", "probe/state", {
      ok: true,
    });
    const events = store.get(session.id).events;
    expect(pluginRecordsOf(events, "git-worktrees")).toEqual([
      {
        pluginId: "git-worktrees",
        key: "probe/state",
        data: { ok: true },
        ts: expect.any(Number),
      },
    ]);
    expect(deriveMessages(events).map((m) => m.role)).toEqual(["user"]);
  });

  it("rejects invalid pluginId / key", () => {
    const store = createMemorySessionStore();
    const session = store.create("s2");
    expect(() =>
      appendPluginRecord(store, session.id, "Bad_Id", "k", {}),
    ).toThrow(/pluginId/);
    expect(() =>
      appendPluginRecord(store, session.id, "ok-id", "BadKey", {}),
    ).toThrow(/key/);
  });
});
