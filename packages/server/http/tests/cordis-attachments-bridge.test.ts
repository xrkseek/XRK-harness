import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCordisAttachmentsBridge } from "../src/dsh-compat/cordis-attachments-bridge.js";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

/** 1×1 PNG — no sharp dependency in server-http tests. */
const TINY_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

describe("cordis-attachments-bridge", () => {
  it("saveImage → imageHostPath → readImage for OFM/channel-pack", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "ofm-att-"));
    temps.push(home);
    const bridge = createCordisAttachmentsBridge(home);
    const saved = await bridge.saveImage({
      data: TINY_PNG,
      mediaType: "image/png",
    });
    expect(saved.attachmentId.startsWith("sha256:")).toBe(true);

    const hostPath = bridge.imageHostPath({
      attachmentId: saved.attachmentId,
      mediaType: saved.mediaType,
    });
    expect(hostPath).toBeTruthy();
    expect(existsSync(hostPath!)).toBe(true);

    const read = await bridge.readImage({
      attachmentId: saved.attachmentId,
      mediaType: saved.mediaType,
    });
    expect(read.data.byteLength).toBeGreaterThan(0);
    expect(read.ref.mediaType).toBe("image/png");
  });

  it("imageHostPath returns undefined for missing ids", () => {
    const home = mkdtempSync(path.join(tmpdir(), "ofm-att-miss-"));
    temps.push(home);
    const bridge = createCordisAttachmentsBridge(home);
    expect(
      bridge.imageHostPath({
        attachmentId:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      }),
    ).toBeUndefined();
  });
});
