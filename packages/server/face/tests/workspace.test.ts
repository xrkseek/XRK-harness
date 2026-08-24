import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
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

describe("Face workspace U2", () => {
  it("describe · listProduct · previewInject · syncSeeds (template)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-face-ws-"));
    const seed = path.join(root, "seed-template");
    await mkdir(path.join(seed, "context"), { recursive: true });
    await writeFile(path.join(seed, "assistant.md"), "You are seed.", "utf8");
    await writeFile(path.join(seed, "context", "note.md"), "ctx", "utf8");

    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: root,
      productDir: path.join(root, ".xrk"),
      seedTemplateDirs: { "office-agent": seed },
      drain: drain(),
      resolveAgent: async (sessionId) =>
        createMinimalComposition({
          workspaceRoot: root,
          sessionStore: store,
          sessionId,
          assemble: true,
          llm: createReplayAdapter([{ content: "x" }]),
          workspaceInject: false,
        }).createAgent(),
    });

    const desc = await dispatchFaceMethod(runtime, "workspace.describe", "d1", {});
    expect(desc.result.ok).toBe(true);
    if (desc.result.ok) {
      const v = desc.result.value as {
        root: string;
        productDir: string;
        productExists: boolean;
        seedTemplates: string[];
      };
      expect(v.root).toBe(path.resolve(root));
      expect(v.productDir.replace(/\\/g, "/")).toContain("/.xrk");
      expect(v.productExists).toBe(false);
      expect(v.seedTemplates).toEqual(["office-agent"]);
    }

    const emptyList = await dispatchFaceMethod(
      runtime,
      "workspace.listProduct",
      "l0",
      {},
    );
    expect(emptyList.result.ok).toBe(true);
    if (emptyList.result.ok) {
      expect(
        (emptyList.result.value as { exists: boolean }).exists,
      ).toBe(false);
    }

    const synced = await dispatchFaceMethod(
      runtime,
      "workspace.syncSeeds",
      "s1",
      { template: "office-agent" },
    );
    expect(synced.result.ok).toBe(true);
    if (synced.result.ok) {
      const v = synced.result.value as { created: string[] };
      expect(v.created.sort()).toEqual(["assistant.md", "context/note.md"]);
    }

    const listed = await dispatchFaceMethod(
      runtime,
      "workspace.listProduct",
      "l1",
      {},
    );
    expect(listed.result.ok).toBe(true);
    if (listed.result.ok) {
      const v = listed.result.value as {
        exists: boolean;
        entries: { path: string; kind: string }[];
      };
      expect(v.exists).toBe(true);
      expect(v.entries.map((e) => e.path).sort()).toEqual([
        "assistant.md",
        "context",
        "context/note.md",
      ]);
    }

    const preview = await dispatchFaceMethod(
      runtime,
      "workspace.previewInject",
      "p1",
      { includeText: true },
    );
    expect(preview.result.ok).toBe(true);
    if (preview.result.ok) {
      const v = preview.result.value as {
        blockCount: number;
        totalChars: number;
        blocks: { heading: string; preview?: string }[];
      };
      expect(v.blockCount).toBeGreaterThan(0);
      expect(v.totalChars).toBeGreaterThan(0);
      expect(v.blocks[0]?.heading).toBeTruthy();
      expect(v.blocks[0]?.preview).toContain(".xrk/assistant.md");
    }

    const badTemplate = await dispatchFaceMethod(
      runtime,
      "workspace.syncSeeds",
      "s2",
      { template: "nope" },
    );
    expect(badTemplate.result.ok).toBe(false);
    if (!badTemplate.result.ok) {
      expect(badTemplate.result.error.code).toBe("workspace-not-found");
    }

    const escape = await dispatchFaceMethod(
      runtime,
      "workspace.syncSeeds",
      "s3",
      { seedDir: ".." },
    );
    expect(escape.result.ok).toBe(false);
    if (!escape.result.ok) {
      expect(escape.result.error.code).toBe("workspace-invalid-path");
    }
  });

  it("workspace.list returns DSH registry shape (not product tree)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-face-ws-list-"));
    const store = createMemorySessionStore();
    store.create("sess_a");
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: root,
      productDir: path.join(root, ".xrk"),
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });

    const listed = await dispatchFaceMethod(runtime, "workspace.list", "wl1", {});
    expect(listed.result.ok).toBe(true);
    if (!listed.result.ok) return;
    const v = listed.result.value as {
      items: {
        workspaceId: string;
        path: string;
        title: string;
        sessionIds: string[];
      }[];
      archivedSessionIds: string[];
    };
    expect(v.archivedSessionIds).toEqual([]);
    expect(v.items).toHaveLength(1);
    expect(v.items[0]?.workspaceId).toBe("ws_default");
    expect(v.items[0]?.path).toBe(path.resolve(root));
    expect(v.items[0]?.title).toBe(path.basename(root));
    expect(v.items[0]?.sessionIds).toEqual([]);
    expect(v).not.toHaveProperty("entries");
    expect(v).not.toHaveProperty("exists");
  });

  it("workspace.create · rename · archiveSession + session cwd attach", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-face-ws-reg-"));
    const other = await mkdtemp(path.join(tmpdir(), "xrk-face-ws-other-"));
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: root,
      productDir: path.join(root, ".xrk"),
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });

    const created = await dispatchFaceMethod(runtime, "workspace.create", "wc1", {
      path: other,
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const ws = (
      created.result.value as {
        workspace: { workspaceId: string; path: string; title: string };
        created: boolean;
      }
    ).workspace;
    expect(created.result.value).toMatchObject({ created: true });
    expect(ws.path).toBe(path.resolve(other));

    const renamed = await dispatchFaceMethod(runtime, "workspace.rename", "wr1", {
      workspaceId: ws.workspaceId,
      title: "Other Box",
    });
    expect(renamed.result.ok).toBe(true);

    const sess = await dispatchFaceMethod(runtime, "session.create", "sc1", {
      workspaceId: ws.workspaceId,
    });
    expect(sess.result.ok).toBe(true);
    if (!sess.result.ok) return;
    const sessionId = (sess.result.value as { sessionId: string }).sessionId;
    expect(runtime.sessionCwds.get(sessionId)).toBe(path.resolve(other));

    const listed = await dispatchFaceMethod(runtime, "session.list", "sl1", {});
    expect(listed.result.ok).toBe(true);
    if (listed.result.ok) {
      const item = (
        listed.result.value as { items: { sessionId: string; cwd: string }[] }
      ).items.find((i) => i.sessionId === sessionId);
      expect(item?.cwd).toBe(path.resolve(other));
    }

    const archived = await dispatchFaceMethod(
      runtime,
      "workspace.archiveSession",
      "wa1",
      { sessionId },
    );
    expect(archived.result.ok).toBe(true);
    if (archived.result.ok) {
      expect(
        (archived.result.value as { archivedSessionIds: string[] })
          .archivedSessionIds,
      ).toContain(sessionId);
    }
  });

  it("workspace.delete · insertBefore · insertSessionBefore", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-face-ws-ord-"));
    const other = await mkdtemp(path.join(tmpdir(), "xrk-face-ws-ord2-"));
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: root,
      productDir: path.join(root, ".xrk"),
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });

    const created = await dispatchFaceMethod(runtime, "workspace.create", "c", {
      path: other,
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const extraId = (
      created.result.value as { workspace: { workspaceId: string } }
    ).workspace.workspaceId;

    const a = await dispatchFaceMethod(runtime, "session.create", "s1", {});
    const b = await dispatchFaceMethod(runtime, "session.create", "s2", {
      workspaceId: extraId,
    });
    expect(a.result.ok && b.result.ok).toBe(true);
    if (!a.result.ok || !b.result.ok) return;
    const sidA = (a.result.value as { sessionId: string }).sessionId;
    const sidB = (b.result.value as { sessionId: string }).sessionId;

    const moved = await dispatchFaceMethod(
      runtime,
      "workspace.insertSessionBefore",
      "is",
      { sessionId: sidB, beforeSessionId: sidA },
    );
    expect(moved.result.ok).toBe(true);

    const reordered = await dispatchFaceMethod(
      runtime,
      "workspace.insertBefore",
      "ib",
      { workspaceId: extraId, beforeId: "ws_default" },
    );
    expect(reordered.result.ok).toBe(true);
    if (reordered.result.ok) {
      const items = (
        reordered.result.value as { items: { workspaceId: string }[] }
      ).items;
      expect(items[0]?.workspaceId).toBe(extraId);
    }

    const deleted = await dispatchFaceMethod(runtime, "workspace.delete", "d", {
      workspaceId: extraId,
    });
    expect(deleted.result.ok).toBe(true);
    if (deleted.result.ok) {
      expect(deleted.result.value).toEqual({ deleted: true });
    }

    const listed = await dispatchFaceMethod(runtime, "workspace.list", "l", {});
    expect(listed.result.ok).toBe(true);
    if (listed.result.ok) {
      const items = (
        listed.result.value as { items: { workspaceId: string }[] }
      ).items;
      expect(items.map((w) => w.workspaceId)).toEqual(["ws_default"]);
    }

    const deleteDefault = await dispatchFaceMethod(
      runtime,
      "workspace.delete",
      "d2",
      { workspaceId: "ws_default" },
    );
    expect(deleteDefault.result.ok).toBe(true);
    if (deleteDefault.result.ok) {
      expect(deleteDefault.result.value).toEqual({ deleted: true });
    }

    const afterDefault = await dispatchFaceMethod(runtime, "workspace.list", "l2", {});
    expect(afterDefault.result.ok).toBe(true);
    if (afterDefault.result.ok) {
      const items = (
        afterDefault.result.value as { items: { workspaceId: string }[] }
      ).items;
      expect(items).toEqual([]);
    }
  });

  it("workspace.create persists to workspaces.json and reloads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-face-ws-persist-"));
    const other = await mkdtemp(path.join(tmpdir(), "xrk-face-ws-persist-o-"));
    const store = createMemorySessionStore();
    const first = createFaceRuntime({
      store,
      workspaceRoot: root,
      productDir: path.join(root, ".xrk"),
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const created = await dispatchFaceMethod(first, "workspace.create", "p1", {
      path: other,
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const title = (
      created.result.value as { workspace: { title: string; workspaceId: string } }
    ).workspace.title;
    await dispatchFaceMethod(first, "workspace.rename", "p2", {
      workspaceId: (
        created.result.value as { workspace: { workspaceId: string } }
      ).workspace.workspaceId,
      title: "Kept Workspace",
    });

    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(path.join(root, ".xrk", "workspaces.json"), "utf8");
    expect(raw).toContain("Kept Workspace");

    const second = createFaceRuntime({
      store: createMemorySessionStore(),
      workspaceRoot: root,
      productDir: path.join(root, ".xrk"),
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const listed = await dispatchFaceMethod(second, "workspace.list", "p3", {});
    expect(listed.result.ok).toBe(true);
    if (!listed.result.ok) return;
    const items = (
      listed.result.value as { items: { title: string; path: string }[] }
    ).items;
    expect(items.some((w) => w.title === "Kept Workspace")).toBe(true);
    expect(items.some((w) => w.path === path.resolve(other))).toBe(true);
    expect(title).toBe(path.basename(other));
  });

  it("persists session↔workspace membership so cwd survives Face rebuild (DSH header.cwd analogue)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-face-cwd-"));
    const other = path.join(root, "agt-project");
    await mkdir(other, { recursive: true });
    const productDir = path.join(root, ".xrk");

    const store = createMemorySessionStore();
    const first = createFaceRuntime({
      store,
      workspaceRoot: root,
      productDir,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const created = await dispatchFaceMethod(first, "workspace.create", "c1", {
      path: other,
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const workspaceId = (
      created.result.value as { workspace: { workspaceId: string } }
    ).workspace.workspaceId;
    const sess = await dispatchFaceMethod(first, "session.create", "c2", {
      workspaceId,
    });
    expect(sess.result.ok).toBe(true);
    if (!sess.result.ok) return;
    const sessionId = (sess.result.value as { sessionId: string }).sessionId;

    // Simulate Host restart: new FaceRuntime, same store + productDir.
    first.sessionCwds.clear();
    const second = createFaceRuntime({
      store,
      workspaceRoot: root,
      productDir,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    expect(second.sessionCwds.get(sessionId)).toBe(path.resolve(other));
    const listed = await dispatchFaceMethod(second, "session.list", "c3", {});
    expect(listed.result.ok).toBe(true);
    if (!listed.result.ok) return;
    const item = (
      listed.result.value as { items: { sessionId: string; cwd: string }[] }
    ).items.find((i) => i.sessionId === sessionId);
    expect(item?.cwd).toBe(path.resolve(other));
  });

  it("persists archivedSessionIds across Face rebuild", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-face-archive-"));
    const productDir = path.join(root, ".xrk");
    const store = createMemorySessionStore();
    const first = createFaceRuntime({
      store,
      workspaceRoot: root,
      productDir,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const sess = await dispatchFaceMethod(first, "session.create", "a1", {});
    expect(sess.result.ok).toBe(true);
    if (!sess.result.ok) return;
    const sessionId = (sess.result.value as { sessionId: string }).sessionId;

    const archived = await dispatchFaceMethod(
      first,
      "workspace.archiveSession",
      "a2",
      { sessionId },
    );
    expect(archived.result.ok).toBe(true);

    const second = createFaceRuntime({
      store,
      workspaceRoot: root,
      productDir,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const listed = await dispatchFaceMethod(second, "workspace.list", "a3", {});
    expect(listed.result.ok).toBe(true);
    if (!listed.result.ok) return;
    const v = listed.result.value as { archivedSessionIds: string[] };
    expect(v.archivedSessionIds).toEqual([sessionId]);
  });
});
