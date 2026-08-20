import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

async function face(opts?: {
  readonly modalities?: readonly ("text" | "image")[];
  /** When true, seed an openai vision route so live-route gate allows images. */
  readonly visionRoute?: boolean;
}) {
  const store = createMemorySessionStore();
  const attachments = createMemoryAttachmentStore();
  let productDir = process.cwd();
  if (opts?.visionRoute) {
    productDir = await mkdtemp(path.join(tmpdir(), "xrk-face-vision-"));
    await writeFile(
      path.join(productDir, "settings.yaml"),
      [
        "llm-pi-ai:",
        "  providers:",
        "    openai:",
        "      baseURL: https://api.openai.com/v1",
        "      api: openai-completions",
        "      models:",
        "        - id: gpt-4.1",
        "          name: GPT",
        "agent-default-model:",
        "  provider: openai",
        "  model: gpt-4.1",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(productDir, ".credentials.yaml"),
      "OPENAI_API_KEY: sk-test-key\n",
      "utf8",
    );
  }
  const runtime = createFaceRuntime({
    store,
    workspaceRoot: productDir,
    productDir,
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
  it("rejects image when Face intake is text-only", async () => {
    const { runtime } = await face({ modalities: ["text"] });
    const created = await dispatchFaceMethod(runtime, "session.create", "r0", {});
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) throw new Error("create failed");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const res = await dispatchFaceMethod(runtime, "session.prompt", "r1", {
      sessionId,
      mode: "queue",
      content: [
        { type: "text", text: "see" },
        { type: "image", mediaType: "image/png", data: PNG_B64 },
      ],
    });
    expect(res.result.ok).toBe(false);
    // Face maps unsupported-modality → wire attachment-error (rpc-error.ts).
    if (!res.result.ok) expect(res.result.error.code).toBe("attachment-error");
  });

  it("rejects image when Face intake allows but live route is text-only", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-face-text-route-"));
    await writeFile(
      path.join(dir, "settings.yaml"),
      [
        "llm-deepseek:",
        "  baseURL: https://api.deepseek.com",
        "  models:",
        "    - id: deepseek-v4-flash",
        "agent-default-model:",
        "  provider: deepseek",
        "  model: deepseek-v4-flash",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(dir, ".credentials.yaml"),
      "DEEPSEEK_API_KEY: sk-test-key\n",
      "utf8",
    );
    const store = createMemorySessionStore();
    const attachments = createMemoryAttachmentStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: dir,
      productDir: dir,
      version: "test",
      registry: createProviderRegistry(),
      attachments,
      inputModalities: ["text", "image"],
      drain: {
        wake: () => undefined,
        cancel: async () => undefined,
        isActive: () => false,
      },
      resolveAgent: async (sessionId) => stubAgent(store, sessionId),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "r0", {});
    if (!created.result.ok) throw new Error("create failed");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const res = await dispatchFaceMethod(runtime, "session.prompt", "r1", {
      sessionId,
      mode: "queue",
      content: [
        { type: "text", text: "see" },
        { type: "image", mediaType: "image/png", data: PNG_B64 },
      ],
    });
    expect(res.result.ok).toBe(false);
    if (!res.result.ok) expect(res.result.error.code).toBe("attachment-error");
  });

  it("persists image refs then session.attachment returns base64", async () => {
    const { runtime, store } = await face({
      modalities: ["text", "image"],
      visionRoute: true,
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "r0", {});
    if (!created.result.ok) throw new Error("create failed");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

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
    expect(prompt.result.ok).toBe(true);

    const pending = listPendingAdmits(store.get(sessionId).events, sessionId);
    expect(pending).toHaveLength(1);
    expect(contentHasImage(pending[0]!.content)).toBe(true);
    const refs = listImageRefs(pending[0]!.content);
    expect(refs).toHaveLength(1);

    const att = await dispatchFaceMethod(runtime, "session.attachment", "r2", {
      sessionId,
      attachmentId: refs[0]!.attachmentId,
    });
    expect(att.result.ok).toBe(true);
    if (att.result.ok) {
      const value = att.result.value as {
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
    const { runtime } = await face({ modalities: ["text", "image"] });
    const created = await dispatchFaceMethod(runtime, "session.create", "r0", {});
    if (!created.result.ok) throw new Error("create failed");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const att = await dispatchFaceMethod(runtime, "session.attachment", "r1", {
      sessionId,
      attachmentId: "sha256:deadbeef",
    });
    expect(att.result.ok).toBe(false);
    if (!att.result.ok) expect(att.result.error.code).toBe("session-not-found");
  });
});
