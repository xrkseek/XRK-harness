import { describe, expect, it, vi } from "vitest";
import type { AttachmentStore } from "@xrkseek/attachment";
import {
  createReadImageTool,
  formatImageReadOutput,
} from "../src/read-image.js";

describe("formatImageReadOutput", () => {
  it("includes coordinate scale advice when originalDimensions present", () => {
    const text = formatImageReadOutput("shots/ui.png", {
      attachmentId: "sha256:abc",
      mediaType: "image/png",
      bytes: 1200,
      width: 512,
      height: 256,
      originalDimensions: { width: 1024, height: 512 },
    });
    expect(text).toContain("multiply coordinates by 2.00");
    expect(text).toContain("downscaled from 1024x512 px");
  });

  it("matches the image-card envelope recognition shape", () => {
    const text = formatImageReadOutput("a.png", {
      attachmentId: "sha256:x",
      mediaType: "image/png",
      bytes: 1,
      width: 1,
      height: 1,
    });
    expect(text).toMatch(
      /^<path>[^\n]*<\/path>\n<type>image<\/type>\n<content>\n[\s\S]*\n<\/content>$/u,
    );
  });

  it("discloses crop offset when region was applied", () => {
    const text = formatImageReadOutput("shots/ui.png", {
      attachmentId: "sha256:abc",
      mediaType: "image/png",
      bytes: 400,
      width: 50,
      height: 30,
      cropOffset: { x: 10, y: 12 },
    });
    expect(text).toContain("offset (10, 12)");
    expect(text).toContain("add the offset to map back to the full image");
  });
});

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
    saveImage: async () => ({
      attachmentId: "sha256:cropped",
      mediaType: "image/png",
      bytes: 12,
      width: 50,
      height: 30,
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

describe("createReadImageTool region", () => {
  it("refuses region when the store has no cropImageRegion", async () => {
    const tool = createReadImageTool({
      fs: {
        stat: async () => ({ isFile: true }),
        readBytes: async () => new Uint8Array([1, 2, 3]),
      },
      attachments: mockAttachments(),
    });
    const result = await tool.execute({
      file_path: "a.png",
      region: [0, 0, 10, 10],
    });
    expect(result.isError).toBe(true);
    expect(String(result.content)).toContain("region cropping requires");
  });

  it("crops before saveImage and surfaces cropOffset in text + meta", async () => {
    const saveImage = vi.fn(async () => ({
      attachmentId: "sha256:cropped",
      mediaType: "image/png" as const,
      bytes: 99,
      width: 50,
      height: 30,
    }));
    const cropImageRegion = vi.fn(async () => ({
      data: new Uint8Array([9, 9, 9]),
      mediaType: "image/png" as const,
      offset: { x: 10, y: 12 },
      sourceSize: { width: 100, height: 80 },
      cropSize: { width: 50, height: 30 },
    }));
    const tool = createReadImageTool({
      fs: {
        stat: async () => ({ isFile: true }),
        readBytes: async () => new Uint8Array([1, 2, 3, 4]),
      },
      attachments: mockAttachments({ saveImage, cropImageRegion }),
    });
    const result = await tool.execute({
      file_path: "shots/ui.png",
      region: [10, 12, 60, 42],
    });
    expect(result.isError).toBeFalsy();
    expect(cropImageRegion).toHaveBeenCalledOnce();
    expect(saveImage).toHaveBeenCalledWith({
      data: new Uint8Array([9, 9, 9]),
      mediaType: "image/png",
      name: "ui.png",
    });
    const content = result.content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) throw new Error("expected content blocks");
    const text = content.find((b) => b.type === "text");
    expect(text && "text" in text ? text.text : "").toContain("offset (10, 12)");
    expect(result.meta).toMatchObject({
      path: "shots/ui.png",
      cropOffset: { x: 10, y: 12 },
    });
  });
});
