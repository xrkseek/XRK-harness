import { accessSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  createLocalAttachmentStore,
  resolveLocalAttachmentCacheRoot,
  resolveLocalAttachmentsRoot,
} from "../src/index.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function png(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 12, g: 34, b: 56 },
      },
    })
      .png()
      .toBuffer(),
  );
}

describe("local request-image cache root", () => {
  it("stores variants under product-home cache and rebuilds after cache wipe", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-req-img-"));
    dirs.push(home);
    const store = createLocalAttachmentStore({ xrkHome: home });
    const durableRoot = resolveLocalAttachmentsRoot(home);
    const cacheRoot = resolveLocalAttachmentCacheRoot(home);
    expect(cacheRoot).toBe(join(home, "cache", "attachments"));
    expect(durableRoot).toBe(join(home, "attachments", "v1"));

    const ref = await store.saveImage({
      data: await png(64, 32),
      mediaType: "image/png",
    });
    const stored = await store.readImage(ref.attachmentId);
    const fileData = Uint8Array.of(0, 1, 2, 255);
    const file = await store.saveFile({ data: fileData, name: "notes.bin" });

    const policy = { maxPixels: 16 * 16, maxBytes: 4_096 };
    const initial = await store.readImageRequest(ref, policy);
    const hash = String(initial.variantId).slice("sha256:".length);
    const cacheFile = join(cacheRoot, "request-images", hash.slice(0, 2), hash);
    const legacyPath = join(
      durableRoot,
      "request-images",
      hash.slice(0, 2),
      hash,
    );

    expect(readFileSync(cacheFile)).toEqual(Buffer.from(initial.data));
    expect(() => accessSync(legacyPath)).toThrow();

    // Wipe rebuildable cache only — durable originals and files stay.
    rmSync(join(home, "cache"), { recursive: true, force: true });
    expect(() => accessSync(cacheFile)).toThrow();

    const reopened = createLocalAttachmentStore({ xrkHome: home });
    await expect(reopened.readImage(ref.attachmentId)).resolves.toEqual(stored);
    const hostPath = reopened.fileHostPath?.(file);
    expect(hostPath).toBeDefined();
    expect(readFileSync(hostPath!)).toEqual(Buffer.from(fileData));

    const regenerated = await reopened.readImageRequest(ref, policy);
    expect(regenerated.data).toEqual(initial.data);
    expect(readFileSync(cacheFile)).toEqual(Buffer.from(regenerated.data));
    // Still never writes under the durable attachments root.
    expect(() => accessSync(legacyPath)).toThrow();
  });
});
