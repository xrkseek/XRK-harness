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
      expect(v.blocks[0]?.preview).toContain("Assistant");
    }

    const badTemplate = await dispatchFaceMethod(
      runtime,
      "workspace.syncSeeds",
      "s2",
      { template: "nope" },
    );
    expect(badTemplate.result.ok).toBe(false);
    if (!badTemplate.result.ok) {
      expect(badTemplate.result.error.code).toBe("seed-template-not-found");
    }

    const escape = await dispatchFaceMethod(
      runtime,
      "workspace.syncSeeds",
      "s3",
      { seedDir: ".." },
    );
    expect(escape.result.ok).toBe(false);
    if (!escape.result.ok) {
      expect(escape.result.error.code).toBe("path-escape");
    }
  });
});
