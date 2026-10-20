import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalAttachmentStore,
  resolveLocalAttachmentsRoot,
  storedImagePath,
} from "../src/index.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("storedImagePath", () => {
  it("points at the content-addressed object after saveImage", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-img-path-"));
    dirs.push(home);
    const store = createLocalAttachmentStore({ xrkHome: home });
    const data = new Uint8Array(
      await sharp({
        create: {
          width: 4,
          height: 4,
          channels: 3,
          background: { r: 1, g: 2, b: 3 },
        },
      })
        .png()
        .toBuffer(),
    );
    const ref = await store.saveImage({ data, mediaType: "image/png" });
    const path = storedImagePath(resolveLocalAttachmentsRoot(home), ref);
    expect(existsSync(path)).toBe(true);
    expect(path.includes("objects")).toBe(true);
  });
});
