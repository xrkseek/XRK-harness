import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createWorkspaceToolOutputPersist,
  resolveProductHome,
  resolveSpillRoot,
} from "../src/index.js";

describe("createWorkspaceToolOutputPersist", () => {
  it("writes under spill/tool-outputs and returns an absolute path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-tool-out-"));
    const store = createWorkspaceToolOutputPersist({ root });
    const abs = await store.persist("full tool body\nline2");
    expect(path.isAbsolute(abs)).toBe(true);
    expect(path.relative(root, abs).replace(/\\/g, "/")).toMatch(
      /^spill\/tool-outputs\/tool_/,
    );
    expect(await readFile(abs, "utf8")).toBe("full tool body\nline2");
  });

  it("defaults to product home, not cwd/workspace", () => {
    const store = createWorkspaceToolOutputPersist();
    expect(store.dir.replace(/\\/g, "/")).toBe(
      path
        .join(resolveProductHome(), "spill", "tool-outputs")
        .replace(/\\/g, "/"),
    );
  });

  it("rejects relativeDir that escapes the persist root", () => {
    expect(() =>
      createWorkspaceToolOutputPersist({
        root: process.cwd(),
        relativeDir: "../outside",
      }),
    ).toThrow(/must stay under product home/);
  });
});

describe("resolveProductHome / resolveSpillRoot", () => {
  it("honors XRK_HOME and expands ~", () => {
    const home = resolveProductHome({ XRK_HOME: "~/xrk-home-test" });
    expect(home.replace(/\\/g, "/")).toMatch(/xrk-home-test$/);
    expect(path.isAbsolute(home)).toBe(true);
    expect(
      resolveSpillRoot({ XRK_HOME: "C:/tmp/xrk-spill" }).replace(/\\/g, "/"),
    ).toMatch(/tmp\/xrk-spill\/spill$/);
  });
});
