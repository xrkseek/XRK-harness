import { describe, expect, it } from "vitest";
import { createMemoryAttachmentStore } from "@xrkseek/attachment";
import {
  admitPrompt,
  createMemorySessionStore,
  listPendingAdmits,
  type SessionStore,
} from "@xrkseek/core-session";
import { createProviderRegistry } from "@xrkseek/llm-registry";
import { contentHasImage, listImageRefs } from "@xrkseek/protocol";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function stubAgent(store: SessionStore, sessionId: string) {
  return {
    continueTurn: async () => {
      throw new Error("no turn");
    },
    run: async () => {
      throw new Error("no turn");
    },
    admit: (
      content: Parameters<typeof admitPrompt>[2],
      options?: Parameters<typeof admitPrompt>[3],
    ) => admitPrompt(store, sessionId, content, options),
    pendingAdmits: () =>
      listPendingAdmits(store.get(sessionId).events, sessionId),
    abort: () => undefined,
    isBusy: () => false,
    setApprovalHandler: () => undefined,
  };
}

function face(opts?: {
  readonly modalities?: readonly ("text" | "image")[];
}) {
  const store = createMemorySessionStore();
  const attachments = createMemoryAttachmentStore();
  const runtime = createFaceRuntime({
    store,
    workspaceRoot: process.cwd(),
    version: "test",
    registry: createProviderRegistry(),
    attachments,
    ...(opts?.modalities ? { inputModalities: opts.modalities } : {}),
    drain: {
      wake: () => undefined,
      cancel: async () => undefined,
      isActive: () => false,
    },
    resolveAgent: async (sessionId) => stubAgent(store, sessionId),
  });
  return { runtime, store, attachments };
}

describe("Face session.attachment / image prompt", () => {
  it("rejects image when route is text-only (default)", async () => {
    const { runtime } = face({ modalities: ["text"] });
    const created = await dispatchFaceMethod(runtime, "session.create", "r0", {});
    expect(created.ok).toBe(true);
    const sessionId = (created as { value: { sessionId: string } }).value
      .sessionId;

    const res = await dispatchFaceMethod(runtime, "session.prompt", "r1", {
      sessionId,
      mode: "queue",
      content: [
        { type: "text", text: "see" },
        { type: "image", mediaType: "image/png", data: PNG_B64 },
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("unsupported-modality");
  });

  it("persists image refs then session.attachment returns base64", async () => {
    const { runtime, store } = face({
      modalities: ["text", "image"],
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "r0", {});
    const sessionId = (created as { value: { sessionId: string } }).value
      .sessionId;

    const prompt = await dispatchFaceMethod(runtime, "session.prompt", "r1", {
      sessionId,
      mode: "queue",
      content: [
        { type: "text", text: "caption" },
        {
          type: "image",
          mediaType: "image/png",
          data: PNG_B64,
          name: "dot.png",
        },
      ],
    });
    expect(prompt.ok).toBe(true);

    const pending = listPendingAdmits(store.get(sessionId).events, sessionId);
    expect(pending).toHaveLength(1);
    expect(contentHasImage(pending[0]!.content)).toBe(true);
    const refs = listImageRefs(pending[0]!.content);
    expect(refs).toHaveLength(1);

    const att = await dispatchFaceMethod(runtime, "session.attachment", "r2", {
      sessionId,
      attachmentId: refs[0]!.attachmentId,
    });
    expect(att.ok).toBe(true);
    if (att.ok) {
      const value = att.value as {
        attachment: { mediaType: string; width: number; height: number };
        data: string;
      };
      expect(value.attachment.mediaType).toBe("image/png");
      expect(value.attachment.width).toBe(1);
      expect(value.attachment.height).toBe(1);
      expect(value.data).toBe(PNG_B64);
    }
  });

  it("denies attachment id not referenced by session", async () => {
    const { runtime } = face({ modalities: ["text", "image"] });
    const created = await dispatchFaceMethod(runtime, "session.create", "r0", {});
    const sessionId = (created as { value: { sessionId: string } }).value
      .sessionId;
    const att = await dispatchFaceMethod(runtime, "session.attachment", "r1", {
      sessionId,
      attachmentId: "sha256:deadbeef",
    });
    expect(att.ok).toBe(false);
    if (!att.ok) expect(att.error.code).toBe("not-found");
  });
});
