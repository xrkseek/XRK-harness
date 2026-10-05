import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FaceSessionThreadStore } from "../src/session-thread-store.js";

describe("FaceSessionThreadStore", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function home(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-threads-"));
    dirs.push(dir);
    return dir;
  }

  it("isolates threads by workspace and binds sessions", () => {
    const store = new FaceSessionThreadStore(home());
    const a = store.upsert("ws_a", { title: "发版" });
    const b = store.upsert("ws_b", { title: "调研" });
    expect(a?.title).toBe("发版");
    expect(b?.title).toBe("调研");
    expect(store.list("ws_a")).toHaveLength(1);
    expect(store.list("ws_b")).toHaveLength(1);
    expect(store.switchTo("ws_a", "sess_1", a!.id)?.threadId).toBe(a!.id);
    expect(store.bindOf("ws_a", "sess_1")?.threadId).toBe(a!.id);
    expect(store.bindOf("ws_b", "sess_1")).toBeUndefined();
  });

  it("keeps sideline when switching mainline", () => {
    const store = new FaceSessionThreadStore(home());
    const first = store.upsert("ws", { title: "主线甲" });
    const second = store.upsert("ws", { title: "主线乙" });
    store.switchTo("ws", "sess", first!.id);
    store.setSideline("ws", "sess", "正在写发行说明");
    const next = store.switchTo("ws", "sess", second!.id);
    expect(next?.threadId).toBe(second!.id);
    expect(next?.sideline).toBe("正在写发行说明");
  });

  it("lists session binds without minting from a prompt hint", () => {
    const store = new FaceSessionThreadStore(home());
    const thread = store.upsert("ws", { title: "发版" });
    store.switchTo("ws", "sess_a", thread!.id);
    store.switchTo("ws", "sess_b", thread!.id);
    expect(store.listBinds("ws").map((row) => row.sessionId).sort()).toEqual([
      "sess_a",
      "sess_b",
    ]);
    expect(store.bindOf("ws", "sess_c")).toBeUndefined();
  });

  it("removes a 主线 and drops binds pointing at it", () => {
    const store = new FaceSessionThreadStore(home());
    const keep = store.upsert("ws", { title: "保留" });
    const drop = store.upsert("ws", { title: "丢掉" });
    store.switchTo("ws", "sess_keep", keep!.id);
    store.switchTo("ws", "sess_drop", drop!.id);
    expect(store.remove("ws", drop!.id)).toBe(true);
    expect(store.list("ws").map((row) => row.id)).toEqual([keep!.id]);
    expect(store.bindOf("ws", "sess_keep")?.threadId).toBe(keep!.id);
    expect(store.bindOf("ws", "sess_drop")).toBeUndefined();
    expect(store.remove("ws", drop!.id)).toBe(false);
  });
});
