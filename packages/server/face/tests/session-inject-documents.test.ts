/** Session inject catalog mirrors turn-start capability / posture / board. */
import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  listSessionInjectDocuments,
  readSessionInjectDocument,
  SESSION_CAPABILITY_PATH,
  SESSION_COLLAB_PATH,
  SESSION_POSTURE_PATH,
} from "../src/session-inject-documents.js";
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

describe("session inject documents", () => {
  it("lists capability with badge and permission lines for a coding session", async () => {
    const store = createMemorySessionStore();
    const root = await mkdtemp(path.join(tmpdir(), "xrk-inj-"));
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: root,
      productDir: root,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const codingRoot = path.join(root, "code-proj");
    const { workspace: codingWs } = runtime.workspaces.create(codingRoot);
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      workspaceId: codingWs.workspaceId,
      agentPreset: "harness",
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const docs = listSessionInjectDocuments(runtime, sessionId);
    const cap = docs.find((d) => d.path === SESSION_CAPABILITY_PATH);
    expect(cap).toMatchObject({
      layer: "session",
      kind: "session-capability",
    });
    expect(cap!.bytes).toBeGreaterThan(0);
    const body = readSessionInjectDocument(
      runtime,
      sessionId,
      SESSION_CAPABILITY_PATH,
    );
    expect(body?.content).toContain("<session_capability>");
    expect(body?.content).toContain("badge:");
    expect(body?.content).toContain("permission_label:");

    const listed = await dispatchFaceMethod(runtime, "skill.list", "s1", {
      sessionId,
    });
    expect(listed.result.ok).toBe(true);
    if (!listed.result.ok) return;
    const value = listed.result.value as {
      documents: readonly { path: string; kind: string }[];
    };
    expect(value.documents.some((d) => d.path === SESSION_CAPABILITY_PATH)).toBe(
      true,
    );

    const board = docs.find((d) => d.path === SESSION_COLLAB_PATH);
    expect(board).toMatchObject({ layer: "session", kind: "collab-board" });
    expect(
      readSessionInjectDocument(runtime, sessionId, SESSION_COLLAB_PATH)?.content,
    ).toContain("<external_collab_board>");
  });

  it("injects coding_parent posture for harness badges", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-inj-post-"));
    const runtime = createFaceRuntime({
      store: createMemorySessionStore(),
      workspaceRoot: root,
      productDir: root,
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const codingRoot = path.join(root, "code-proj");
    const { workspace: codingWs } = runtime.workspaces.create(codingRoot);
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      workspaceId: codingWs.workspaceId,
      agentPreset: "harness",
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const docs = listSessionInjectDocuments(runtime, sessionId);
    expect(docs.some((d) => d.path === SESSION_POSTURE_PATH)).toBe(true);
    expect(
      readSessionInjectDocument(runtime, sessionId, SESSION_POSTURE_PATH)?.content,
    ).toMatch(/coding_parent/);
  });
});
