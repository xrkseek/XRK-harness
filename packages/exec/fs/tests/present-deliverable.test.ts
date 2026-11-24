import { describe, expect, it, vi } from "vitest";
import type { AttachmentStore } from "@xrkseek/attachment";
import { createPresentTool } from "../src/present-deliverable.js";

function mockAttachments(
  overrides: Partial<AttachmentStore> = {},
): AttachmentStore {
  return {
    imageLimits: {
      maxImageBytes: 1_000_000,
      maxImagesPerMessage: 4,
      maxMessageImageBytes: 2_000_000,
      maxImagePixels: 10_000_000,
      maxImageDimension: 8192,
      mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    },
    fileLimits: {
      maxFileBytes: 1_000_000,
      maxFilesPerMessage: 4,
      maxMessageFileBytes: 2_000_000,
    },
    validateImage: async () => {},
    saveImages: async () => [],
    saveImage: async (input) => ({
      attachmentId: "sha256:present-img",
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 16,
      height: 9,
      name: input.name,
      ...(input.sourcePath !== undefined ? { sourcePath: input.sourcePath } : {}),
    }),
    readImage: async () => {
      throw new Error("unused");
    },
    validateFile: async () => {},
    saveFiles: async () => [],
    saveFile: async () => {
      throw new Error("unused");
    },
    readFile: async () => {
      throw new Error("unused");
    },
    ...overrides,
  };
}

describe("createPresentTool", () => {
  it("returns path text only when no attachment store is wired", async () => {
    const tool = createPresentTool({
      stat: async () => ({ isFile: true }),
    });
    const out = await tool.execute(
      { files: [{ path: "out/a.png", description: "preview" }] },
      undefined,
    );
    expect(out.isError).toBeFalsy();
    expect(out.content).toBe("presented out/a.png (preview)");
  });

  it("attaches durable image blocks for SVG deliverables", async () => {
    const importImageFile = vi.fn(async () => ({
      attachmentId: "sha256:svg-png",
      mediaType: "image/png" as const,
      bytes: 12,
      width: 64,
      height: 64,
      name: "mark.svg",
    }));
    const tool = createPresentTool(
      {
        stat: async () => ({ isFile: true }),
        readBytes: async () => new Uint8Array([1, 2, 3]),
      },
      { attachments: mockAttachments({ importImageFile }) },
    );
    const out = await tool.execute(
      { files: [{ path: "out/mark.svg" }] },
      undefined,
    );
    expect(out.isError).toBeFalsy();
    const parts = out.content as Array<{ type: string; attachment?: { attachmentId: string } }>;
    expect(parts[1]?.type).toBe("image");
    expect(parts[1]?.attachment?.attachmentId).toBe("sha256:svg-png");
    expect(importImageFile).toHaveBeenCalled();
  });

  it("attaches durable image blocks for PNG deliverables", async () => {
    const readBytes = vi.fn(async () => new Uint8Array([1, 2, 3, 4]));
    const saveImage = vi.fn(async (input: { mediaType: string; name?: string; sourcePath?: string; data: Uint8Array }) => ({
      attachmentId: "sha256:deck",
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 80,
      height: 45,
      name: input.name,
      sourcePath: input.sourcePath,
    }));
    const tool = createPresentTool(
      {
        stat: async () => ({ isFile: true }),
        readBytes,
      },
      { attachments: mockAttachments({ saveImage }) },
    );
    const out = await tool.execute(
      { files: [{ path: "out/deck.png", description: "6-page preview" }] },
      undefined,
    );
    expect(out.isError).toBeFalsy();
    expect(Array.isArray(out.content)).toBe(true);
    const parts = out.content as Array<{ type: string; text?: string; attachment?: { attachmentId: string } }>;
    expect(parts[0]?.type).toBe("text");
    expect(parts[0]?.text).toBe("presented out/deck.png (6-page preview)");
    expect(parts[1]?.type).toBe("image");
    expect(parts[1]?.attachment?.attachmentId).toBe("sha256:deck");
    expect(readBytes).toHaveBeenCalledWith("out/deck.png", expect.any(Number));
    expect(saveImage).toHaveBeenCalled();
  });

  it("keeps non-image files as path text and still attaches sibling images", async () => {
    const tool = createPresentTool(
      {
        stat: async () => ({ isFile: true }),
        readBytes: async () => new Uint8Array([9, 9]),
      },
      { attachments: mockAttachments() },
    );
    const out = await tool.execute(
      {
        files: [
          { path: "out/notes.md" },
          { path: "out/chart.png" },
        ],
      },
      undefined,
    );
    const parts = out.content as Array<{ type: string }>;
    expect(parts.filter((p) => p.type === "text")).toHaveLength(1);
    expect(parts.filter((p) => p.type === "image")).toHaveLength(1);
  });
});
