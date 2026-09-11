import { describe, expect, it } from "vitest";
import {
  AttachmentError,
  createMemoryAttachmentStore,
  sniffImageMediaType,
} from "../src/index.js";

/** 1×1 PNG */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function pngBytes(): Uint8Array {
  return Uint8Array.from(Buffer.from(PNG_B64, "base64"));
}

describe("@xrkseek/attachment memory store", () => {
  it("sniffs png magic", () => {
    expect(sniffImageMediaType(pngBytes())).toBe("image/png");
  });

  it("saveImages then readImage round-trips", async () => {
    const store = createMemoryAttachmentStore();
    const data = pngBytes();
    const [ref] = await store.saveImages([
      { data, mediaType: "image/png", name: "dot.png" },
    ]);
    expect(ref!.attachmentId.startsWith("sha256:")).toBe(true);
    expect(ref!.width).toBe(1);
    expect(ref!.height).toBe(1);
    expect(ref!.bytes).toBe(data.byteLength);
    expect(ref!.name).toBe("dot.png");

    const stored = await store.readImage(ref!.attachmentId);
    expect(stored.ref).toEqual(ref);
    expect(stored.data).toEqual(data);
  });

  it("rejects media type mismatch before write", async () => {
    const store = createMemoryAttachmentStore();
    await expect(
      store.saveImages([{ data: pngBytes(), mediaType: "image/jpeg" }]),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE" } satisfies Partial<AttachmentError>);
  });

  it("rejects oversized single image", async () => {
    const store = createMemoryAttachmentStore({
      imageLimits: { maxImageBytes: 8 },
    });
    await expect(
      store.saveImages([{ data: pngBytes(), mediaType: "image/png" }]),
    ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  });

  it("dedupes by content hash", async () => {
    const store = createMemoryAttachmentStore();
    const a = await store.saveImage({ data: pngBytes(), mediaType: "image/png" });
    const b = await store.saveImage({ data: pngBytes(), mediaType: "image/png" });
    expect(a.attachmentId).toBe(b.attachmentId);
  });

  it("saveFiles then readFile round-trips", async () => {
    const store = createMemoryAttachmentStore();
    const data = new TextEncoder().encode("hello-file");
    const [ref] = await store.saveFiles([
      { data, name: "note.txt", mediaType: "text/plain" },
    ]);
    expect(ref!.attachmentId.startsWith("sha256:")).toBe(true);
    expect(ref!.name).toBe("note.txt");
    expect(ref!.bytes).toBe(data.byteLength);
    expect(ref!.mediaType).toBe("text/plain");
    const stored = await store.readFile(ref!.attachmentId);
    expect(stored.ref).toEqual(ref);
    expect(stored.data).toEqual(data);
  });

  it("rejects path-like file names by sanitizing to leaf", async () => {
    const store = createMemoryAttachmentStore();
    const ref = await store.saveFile({
      data: new TextEncoder().encode("x"),
      name: "C:\\\\Users\\\\x\\\\evil.pdf",
    });
    expect(ref.name).toBe("evil.pdf");
    expect(ref.name.includes("\\")).toBe(false);
  });

  it("rejects oversized single file", async () => {
    const store = createMemoryAttachmentStore({
      fileLimits: { maxFileBytes: 4 },
    });
    await expect(
      store.saveFiles([{ data: new TextEncoder().encode("too-big"), name: "a.bin" }]),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });
});
