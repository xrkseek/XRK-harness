import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FaceCanvasStore } from "../src/canvas-store.js";
import { createToolRegistry } from "@xrkseek/core-tools";
import { bindCanvasTools } from "../src/canvas-tools.js";
import type { FaceRuntime } from "../src/context.js";

describe("FaceCanvasStore", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function home(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-canvas-"));
    dirs.push(dir);
    return dir;
  }

  it("isolates documents by workspaceId", () => {
    const store = new FaceCanvasStore(home());
    store.upsert("ws_a", {
      id: "overview",
      title: "A",
      sections: [{ kind: "markdown", body: "a" }],
    });
    store.upsert("ws_b", {
      id: "overview",
      title: "B",
      sections: [{ kind: "markdown", body: "b" }],
    });
    expect(store.get("ws_a", "overview")?.title).toBe("A");
    expect(store.get("ws_b", "overview")?.title).toBe("B");
    expect(store.list("ws_a")).toHaveLength(1);
    expect(store.list("ws_b")).toHaveLength(1);
  });

  it("keeps files after delete of unrelated canvas", () => {
    const store = new FaceCanvasStore(home());
    store.upsert("ws_a", {
      id: "one",
      title: "One",
      sections: [],
    });
    store.upsert("ws_a", {
      id: "two",
      title: "Two",
      sections: [],
    });
    expect(store.delete("ws_a", "one")).toBe(true);
    expect(store.get("ws_a", "two")?.title).toBe("Two");
    expect(store.list("ws_a").map((r) => r.id)).toEqual(["two"]);
  });

  it("bumps revision on upsert", () => {
    const store = new FaceCanvasStore(home());
    const first = store.upsert("ws", {
      id: "board",
      title: "v1",
      sections: [],
    });
    const second = store.upsert("ws", {
      id: "board",
      title: "v2",
      sections: [{ kind: "kpi", items: [{ label: "x", value: "1" }] }],
    });
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect(second.createdAt).toBe(first.createdAt);
  });
});

describe("bindCanvasTools", () => {
  it("refuses invalid ids on upsert", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-canvas-tools-"));
    const store = new FaceCanvasStore(home);
    const tools = createToolRegistry();
    const runtime = {
      canvases: store,
      workspaces: {
        workspaceIdOf: () => "ws_default",
        findByPath: () => undefined,
        defaultId: () => "ws_default",
      },
    } as unknown as FaceRuntime;
    bindCanvasTools(tools, { runtime, sessionId: "s1" });
    const upsert = tools.get("canvas_upsert")!;
    const bad = await upsert.execute({
      id: "../escape",
      title: "x",
      sections: [],
    });
    expect(bad.isError).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });
});
