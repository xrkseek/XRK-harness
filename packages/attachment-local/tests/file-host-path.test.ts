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

  it("readFile recovers the alias filename from the digest id", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-att-"));
    dirs.push(home);
    const store = createLocalAttachmentStore({ xrkHome: home });
    const data = new TextEncoder().encode("alias leaf\n");
    const ref = await store.saveFile({ data, name: "brief.docx" });
    const stored = await store.readFile(ref.attachmentId);
    expect(stored.ref.name).toBe("brief.docx");
    expect(new TextDecoder().decode(stored.data)).toBe("alias leaf\n");
  });

  it("persists drag/drop sourcePath and restores it on readFile", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-att-"));
    dirs.push(home);
    const store = createLocalAttachmentStore({ xrkHome: home });
    const data = new TextEncoder().encode("dropped\n");
    const sourcePath = join(home, "Desktop", "drop.txt");
    const ref = await store.saveFile({
      data,
      name: "drop.txt",
      sourcePath,
    });
    expect(ref.sourcePath).toBe(sourcePath);
    const stored = await store.readFile(ref.attachmentId);
    expect(stored.ref.sourcePath).toBe(sourcePath);
  });

  it("ignores clipboard-style non-absolute sourcePath", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-att-"));
    dirs.push(home);
    const store = createLocalAttachmentStore({ xrkHome: home });
    const data = new TextEncoder().encode("paste\n");
    const ref = await store.saveFile({
      data,
      name: "paste.png",
      sourcePath: "paste.png",
    });
    expect(ref.sourcePath).toBeUndefined();
  });
});
