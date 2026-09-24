import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyPatchToFs,
  createFsLocalProvider,
  createFsTools,
  parsePatch,
  seekSequence,
} from "../src/index.js";

describe("parsePatch", () => {
  it("parses add / update / delete hunks", () => {
    const parsed = parsePatch(`*** Begin Patch
*** Add File: bar.md
+hello
*** Update File: foo.txt
@@
-a
+b
*** Delete File: obsolete.txt
*** End Patch`);
    expect(parsed.hunks).toHaveLength(3);
    expect(parsed.hunks[0]).toMatchObject({
      kind: "add",
      path: "bar.md",
      contents: "hello\n",
    });
    expect(parsed.hunks[1]?.kind).toBe("update");
    expect(parsed.hunks[2]).toEqual({ kind: "delete", path: "obsolete.txt" });
  });

  it("rejects missing End Patch", () => {
    expect(() =>
      parsePatch("*** Begin Patch\n*** Add File: a\n+x\n"),
    ).toThrow(/End Patch/);
  });
});

describe("seekSequence", () => {
  it("matches exact then rstrip", () => {
    expect(seekSequence(["foo", "bar", "baz"], ["bar", "baz"], 0, false)).toBe(
      1,
    );
    expect(
      seekSequence(["foo   ", "bar\t"], ["foo", "bar"], 0, false),
    ).toBe(0);
  });
});

describe("applyPatchToFs", () => {
  it("add → update → delete against a workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-ap-"));
    await writeFile(path.join(root, "keep.txt"), "stay\n", "utf8");
    await writeFile(path.join(root, "old.txt"), "line1\nold\nline3\n", "utf8");
    await writeFile(path.join(root, "gone.txt"), "bye\n", "utf8");
    const fs = createFsLocalProvider({ root });

    const result = await applyPatchToFs(
      fs,
      `*** Begin Patch
*** Add File: new.txt
+created
*** Update File: old.txt
@@
 line1
-old
+new
 line3
*** Delete File: gone.txt
*** End Patch`,
    );
    expect(result.hunkCount).toBe(3);
    expect(await readFile(path.join(root, "new.txt"), "utf8")).toBe("created\n");
    expect(await readFile(path.join(root, "old.txt"), "utf8")).toBe(
      "line1\nnew\nline3\n",
    );
    await expect(readFile(path.join(root, "gone.txt"), "utf8")).rejects.toThrow();
    expect(await readFile(path.join(root, "keep.txt"), "utf8")).toBe("stay\n");
  });

  it("preserves CRLF on update", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-ap-crlf-"));
    await writeFile(path.join(root, "lines.txt"), "a\r\nb\r\nc\r\n", "utf8");
    const fs = createFsLocalProvider({ root });
    await applyPatchToFs(
      fs,
      `*** Begin Patch
*** Update File: lines.txt
@@
 a
-b
+B
 c
*** End Patch`,
    );
    expect(await readFile(path.join(root, "lines.txt"), "utf8")).toBe(
      "a\r\nB\r\nc\r\n",
    );
  });

  it("registers apply_patch tool and applies via execute", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-ap-tool-"));
    await writeFile(path.join(root, "a.txt"), "hello\n", "utf8");
    const tools = createFsTools(createFsLocalProvider({ root }));
    const tool = tools.find((t) => t.name === "apply_patch")!;
    const out = await tool.execute({
      patch: `*** Begin Patch
*** Update File: a.txt
@@
-hello
+world
*** End Patch`,
    });
    expect(out.isError).toBeFalsy();
    expect(String(out.content)).toContain("update a.txt");
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("world\n");
  });
});
