import { describe, expect, it } from "vitest";
import { createMemoryAttachmentStore } from "@xrkseek/attachment";
import { durablePromptContent } from "../src/durable-prompt.js";

describe("durablePromptContent attachmentId reuse", () => {
  it("re-admits an existing file by store id without re-upload", async () => {
    const attachments = createMemoryAttachmentStore();
    const bytes = new TextEncoder().encode("cover-bytes");
    const [saved] = await attachments.saveFiles([
      {
        data: bytes,
        name: "cover.docx",
        mediaType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    ]);
    expect(saved).toBeDefined();

    const reused = await durablePromptContent(
      [
        { type: "file", attachmentId: saved!.attachmentId },
        { type: "text", text: "人工智能作业都加上封面，你看看" },
      ],
      attachments,
    );
    expect(reused.ok).toBe(true);
    if (!reused.ok) return;
    expect(Array.isArray(reused.content)).toBe(true);
    const blocks = reused.content as readonly {
      type?: string;
      attachment?: { attachmentId?: string; name?: string };
      text?: string;
      modelOnly?: boolean;
    }[];
    const file = blocks.find((b) => b.type === "file");
    expect(file?.attachment?.attachmentId).toBe(saved!.attachmentId);
    expect(file?.attachment?.name).toBe("cover.docx");
    expect(
      blocks.some(
        (b) =>
          b.type === "text" &&
          b.modelOnly !== true &&
          b.text === "人工智能作业都加上封面，你看看",
      ),
    ).toBe(true);
  });

  it("fails cleanly when the store id is missing", async () => {
    const attachments = createMemoryAttachmentStore();
    const missing = await durablePromptContent(
      [{ type: "file", attachmentId: "sha256:missing" }],
      attachments,
    );
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.code).toMatch(/not-found|attachment/i);
  });

  it("re-stamps image display name when the store object has none", async () => {
    const attachments = createMemoryAttachmentStore();
    // Tiny 1×1 PNG
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const [saved] = await attachments.saveImages([
      { data: png, mediaType: "image/png" },
    ]);
    expect(saved?.name).toBeUndefined();

    const reused = await durablePromptContent(
      [
        {
          type: "image",
          attachmentId: saved!.attachmentId,
          name: "xrk-e2e-sample2.png",
        },
        { type: "text", text: "seen" },
      ],
      attachments,
    );
    expect(reused.ok).toBe(true);
    if (!reused.ok) return;
    const blocks = reused.content as readonly {
      type?: string;
      attachment?: { attachmentId?: string; name?: string };
    }[];
    const image = blocks.find((b) => b.type === "image");
    expect(image?.attachment?.attachmentId).toBe(saved!.attachmentId);
    expect(image?.attachment?.name).toBe("xrk-e2e-sample2.png");
  });
});
