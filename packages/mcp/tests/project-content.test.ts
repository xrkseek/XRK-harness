import { describe, expect, it } from "vitest";
import { createMemoryAttachmentStore } from "@xrkseek/attachment";
import {
  extractMcpText,
  imageDiagnostic,
  mapMcpCallContent,
  projectMcpContent,
} from "../src/project-content.js";

/** Minimal 1×1 PNG (canonical base64). */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("mcp project-content (DSH-aligned)", () => {
  it("joins text and never JSON-dumps image payloads", () => {
    const text = extractMcpText(
      [
        { type: "text", text: "hello" },
        {
          type: "image",
          mimeType: "image/png",
          data: PNG_B64,
        },
        { type: "resource_link", name: "doc", uri: "file:///a.md" },
        { type: "audio", mimeType: "audio/wav", data: "AAAA" },
        { type: "resource" },
        { type: "mystery" },
      ],
      "shot",
    );
    expect(text).toContain("hello");
    expect(text).toContain("Resource link: doc (file:///a.md)");
    expect(text).toContain("[audio result unsupported:");
    expect(text).toContain("[embedded resource unsupported");
    expect(text).toContain("[unsupported MCP content type: mystery]");
    expect(text).toContain("[image unavailable:");
    expect(text).not.toContain(PNG_B64);
    expect(text).not.toContain('"data"');
  });

  it("admits images to AttachmentStore when modality allows", async () => {
    const store = createMemoryAttachmentStore();
    const mapped = await mapMcpCallContent(
      {
        content: [
          { type: "text", text: "see" },
          { type: "image", mimeType: "image/png", data: PNG_B64 },
        ],
      },
      "vision",
      {
        attachments: store,
        allowsImageInput: () => true,
      },
    );
    expect(Array.isArray(mapped.content)).toBe(true);
    const blocks = mapped.content as { type: string; attachment?: { attachmentId: string } }[];
    expect(blocks[0]).toEqual({ type: "text", text: "see" });
    expect(blocks[1]?.type).toBe("image");
    expect(blocks[1]?.attachment?.attachmentId).toMatch(/^sha256:/);
    const stored = await store.readImage(blocks[1]!.attachment!.attachmentId);
    expect(stored.ref.mediaType).toBe("image/png");
  });

  it("refuses images with diagnostic text when modality denies", async () => {
    const store = createMemoryAttachmentStore();
    const mapped = await mapMcpCallContent(
      {
        content: [
          { type: "image", mimeType: "image/png", data: PNG_B64 },
        ],
      },
      "vision",
      {
        attachments: store,
        allowsImageInput: () => false,
      },
    );
    expect(typeof mapped.content).toBe("string");
    expect(mapped.content).toContain("does not declare image input");
    expect(mapped.content).not.toContain(PNG_B64);
  });

  it("projects invalid image batches as diagnostics without partial admit", async () => {
    const blocks = projectMcpContent(
      [
        { type: "image", mimeType: "image/png", data: "!!!not-base64!!!" },
        { type: "text", text: "ok" },
      ],
      "bad",
      (block) => ({
        type: "text",
        text: imageDiagnostic(block, "the image data is not canonical base64"),
      }),
    );
    expect(blocks.some((b) => b.type === "image")).toBe(false);
    expect(blocks.map((b) => (b.type === "text" ? b.text : "")).join("\n")).toContain(
      "ok",
    );
  });
});
