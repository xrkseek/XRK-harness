import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceToolOutputPersist } from "../src/index.js";

describe("createWorkspaceToolOutputPersist", () => {
  it("writes under .xrk/tool-outputs and returns relative path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-tool-out-"));
    const store = createWorkspaceToolOutputPersist({ root });
    const rel = await store.persist("full tool body\nline2");
    expect(rel.startsWith(".xrk/tool-outputs/tool_")).toBe(true);
    expect(rel.includes("\\")).toBe(false);
    const abs = path.join(root, rel);
    expect(await readFile(abs, "utf8")).toBe("full tool body\nline2");
  });

  it("rejects relativeDir that escapes root", () => {
    expect(() =>
      createWorkspaceToolOutputPersist({
        root: process.cwd(),
        relativeDir: "../outside",
      }),
    ).toThrow(/must stay under workspace root/);
  });
});
