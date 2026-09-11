import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalAttachmentStore,
  resolveLocalAttachmentsRoot,
  storedFilePath,
} from "../src/index.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("local AttachmentStore fileHostPath", () => {
  it("publishes a filename alias and returns an absolute readable path", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-att-"));
    dirs.push(home);
    const store = createLocalAttachmentStore({ xrkHome: home });
    const data = new TextEncoder().encode("hello upload\n");
    const ref = await store.saveFile({ data, name: "note.txt" });
    const hostPath = store.fileHostPath?.(ref);
    expect(hostPath).toBe(storedFilePath(resolveLocalAttachmentsRoot(home), ref));
    expect(hostPath?.endsWith(join("note.txt"))).toBe(true);
    expect(readFileSync(hostPath!, "utf8")).toBe("hello upload\n");
  });

  it("rejects invalid refs from fileHostPath", () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-att-"));
    dirs.push(home);
    const store = createLocalAttachmentStore({ xrkHome: home });
    expect(() =>
      store.fileHostPath?.({
        attachmentId: "not-a-digest",
        name: "x.txt",
        bytes: 1,
      }),
    ).toThrow(/invalid/i);
  });
});
