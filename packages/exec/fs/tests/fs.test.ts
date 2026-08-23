import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  EditMismatchError,
  PathEscapeError,
  createFsLocalProvider,
  createFsTools,
  matchGlob,
  resolveWithinRoot,
} from "../src/index.js";

describe("FsService", () => {
  it("rejects absolute and .. escape", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-fs-"));
    expect(() => resolveWithinRoot(root, "../x")).toThrow(PathEscapeError);
    expect(() =>
      resolveWithinRoot(root, path.resolve(root, "../outside.txt")),
    ).toThrow(PathEscapeError);
  });

  it("reads/writes and emits intents", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-fs-"));
    const fs = createFsLocalProvider({ root });
    const intents: string[] = [];
    fs.onIntent((k, p) => intents.push(`${k}:${p}`));
    await fs.write("a.txt", "hi");
    const out = await fs.read("a.txt");
    expect(out.content).toBe("hi");
    expect(intents).toEqual([
      "fs/write-intent:a.txt",
      "fs/read-intent:a.txt",
    ]);
  });

  it("edit fails without matching old content", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-fs-"));
    const fs = createFsLocalProvider({ root });
    await fs.write("a.txt", "old");
    await expect(fs.edit("a.txt", "wrong", "new")).rejects.toBeInstanceOf(
      EditMismatchError,
    );
    await fs.edit("a.txt", "old", "new");
    expect((await fs.read("a.txt")).content).toBe("new");
  });

  it("tools consume FsService — stub provider needs no tool changes", async () => {
    const stub = {
      root: "/virtual",
      resolvePath: (p: string) => p,
      read: vi.fn(async () => ({ content: "stub" })),
      readBytes: vi.fn(async () => new Uint8Array()),
      write: vi.fn(async () => {}),
      edit: vi.fn(async () => {}),
      stat: vi.fn(async () => ({
        size: 0,
        isFile: true,
        isDirectory: false,
      })),
      mkdir: vi.fn(async () => {}),
      glob: vi.fn(async () => ["x.ts"]),
      grep: vi.fn(async () => [{ path: "x.ts", line: 1, text: "hi" }]),
      onIntent: () => () => {},
    };
    const tools = createFsTools(stub);
    const read = tools.find((t) => t.name === "read_file")!;
    const out = await read.execute({ path: "x" });
    expect(out.content).toBe("stub");
    expect(stub.read).toHaveBeenCalledWith("x");
  });

  it("registers read_file write_file apply_edit glob grep", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-fs-"));
    await writeFile(path.join(root, "a.txt"), "hi", "utf8");
    const tools = createFsTools(createFsLocalProvider({ root }));
    expect(tools.map((t) => t.name)).toEqual([
      "read_file",
      "write_file",
      "apply_edit",
      "glob",
      "grep",
    ]);
  });

  it("glob and grep stay inside the workspace", async () => {
    expect(matchGlob("src/a.ts", "**/*.ts")).toBe(true);
    expect(matchGlob("a.ts", "**/*.ts")).toBe(true);
    expect(matchGlob("a.ts", "*.ts")).toBe(true);
    expect(matchGlob("src/a.ts", "*.ts")).toBe(false);

    const root = await mkdtemp(path.join(tmpdir(), "xrk-fs-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "a.ts"), "const x = 1;\n", "utf8");
    await writeFile(path.join(root, "src", "b.md"), "nope\n", "utf8");
    await writeFile(path.join(root, "readme.txt"), "hello findme\n", "utf8");

    const fs = createFsLocalProvider({ root });
    expect(await fs.glob("**/*.ts")).toEqual(["src/a.ts"]);
    expect(await fs.glob("*.txt")).toEqual(["readme.txt"]);

    const hits = await fs.grep("findme");
    expect(hits).toEqual([
      { path: "readme.txt", line: 1, text: "hello findme" },
    ]);

    const filtered = await fs.grep("const", { glob: "**/*.ts" });
    expect(filtered).toEqual([
      { path: "src/a.ts", line: 1, text: "const x = 1;" },
    ]);

    await expect(fs.grep("x", { path: "../outside" })).rejects.toThrow(
      PathEscapeError,
    );

    const tools = createFsTools(fs);
    const globTool = tools.find((t) => t.name === "glob")!;
    const grepTool = tools.find((t) => t.name === "grep")!;
    expect((await globTool.execute({ pattern: "**/*.ts" })).content).toBe(
      "src/a.ts",
    );
    expect(
      (await grepTool.execute({ pattern: "findme" })).content,
    ).toContain("readme.txt:1:");
  });
});
