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
  it("rejects .. escape and absolute paths outside the root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-fs-"));
    expect(() => resolveWithinRoot(root, "../x")).toThrow(PathEscapeError);
    expect(() =>
      resolveWithinRoot(root, path.resolve(root, "../outside.txt")),
    ).toThrow(PathEscapeError);
  });

  it("allows absolute paths that stay inside the workspace root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-fs-"));
    const inside = path.join(root, "nested", "a.txt");
    expect(resolveWithinRoot(root, inside)).toBe(path.resolve(inside));
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

  it("edit replaces a unique LF-normalized snippet and preserves CRLF", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-fs-"));
    const fs = createFsLocalProvider({ root });
    await fs.write("a.txt", "line1\r\nold\r\nline3\r\n");
    await expect(fs.edit("a.txt", "missing", "new")).rejects.toBeInstanceOf(
      EditMismatchError,
    );
    await fs.edit("a.txt", "old", "new");
    expect((await fs.read("a.txt")).content).toBe("line1\r\nnew\r\nline3\r\n");
  });

  it("tools consume FsService — stub provider needs no tool changes", async () => {
    const stub = {
      root: "/virtual",
      resolvePath: (p: string) => p,
      read: vi.fn(async () => ({ content: "stub" })),
      readBytes: vi.fn(async () => new Uint8Array()),
      write: vi.fn(async () => {}),
      edit: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
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
    expect(out.content).toBe("1|stub");
    expect(stub.read).toHaveBeenCalledWith("x");
  });

  it("read_file window uses offset/limit and line numbers", async () => {
    const stub = {
      root: "/virtual",
      resolvePath: (p: string) => p,
      read: vi.fn(async () => ({ content: "a\nb\nc\nd\n" })),
      readBytes: vi.fn(async () => new Uint8Array()),
      write: vi.fn(async () => {}),
      edit: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      stat: vi.fn(async () => ({
        size: 0,
        isFile: true,
        isDirectory: false,
      })),
      mkdir: vi.fn(async () => {}),
      glob: vi.fn(async () => []),
      grep: vi.fn(async () => []),
      onIntent: () => () => {},
    };
    const tools = createFsTools(stub);
    const read = tools.find((t) => t.name === "read_file")!;
    const out = await read.execute({ path: "x", offset: 2, limit: 2 });
    expect(out.content).toBe("2|b\n3|c\n\n[… 2 more lines; use offset=4]");
  });

  it("registers read_file write_file apply_edit apply_patch glob grep present", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-fs-"));
    await writeFile(path.join(root, "a.txt"), "hi", "utf8");
    const tools = createFsTools(createFsLocalProvider({ root }));
    expect(tools.map((t) => t.name)).toEqual([
      "read_file",
      "write_file",
      "apply_edit",
      "apply_patch",
      "glob",
      "grep",
      "present",
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

    // Regression: a file sorted late by readdir must still be found even when
    // the directory holds more entries than the old hard-coded walk cap (2000).
    const deep = path.join(root, "bulk");
    await mkdir(deep, { recursive: true });
    for (let i = 0; i < 2500; i += 1) {
      await writeFile(path.join(deep, `f${String(i).padStart(4, "0")}.txt`), "x\n", "utf8");
    }
    await writeFile(path.join(deep, "zz-target.md"), "target\n", "utf8");

    const fs = createFsLocalProvider({ root });
    expect(await fs.glob("*.txt")).toEqual(["readme.txt"]);
    expect(await fs.glob("bulk/*.md")).toEqual(["bulk/zz-target.md"]);
    expect(await fs.grep("target", { path: "bulk" })).toEqual([
      { path: "bulk/zz-target.md", line: 1, text: "target" },
    ]);
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
    // The case seeds a 2 500-entry directory; the walk itself is the point,
    // but the default 5 s budget is tight when the whole lane runs in
    // parallel on Windows.
  }, 30_000);

  it("read_file may open absolute paths under hostReadableRoots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-fs-ws-"));
    const host = await mkdtemp(path.join(tmpdir(), "xrk-fs-host-"));
    const alias = path.join(host, "files", "ab", "digest", "note.txt");
    await mkdir(path.dirname(alias), { recursive: true });
    await writeFile(alias, "from-attachment\n", "utf8");
    const fs = createFsLocalProvider({ root, hostReadableRoots: [host] });
    expect((await fs.read(alias)).content).toBe("from-attachment\n");
    await expect(fs.write(alias, "nope")).rejects.toThrow(PathEscapeError);
  });

  it("hostReadableRoots deny sibling home files and symlink escape from spill", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-fs-ws-"));
    const home = await mkdtemp(path.join(tmpdir(), "xrk-fs-home-"));
    const spill = path.join(home, "spill");
    const secret = path.join(home, "host-settings.json");
    await mkdir(spill, { recursive: true });
    await writeFile(secret, '{"token":"nope"}\n', "utf8");
    await writeFile(path.join(spill, "ok.txt"), "spill-ok\n", "utf8");

    const fs = createFsLocalProvider({
      root,
      hostReadableRoots: [spill],
    });
    expect((await fs.read(path.join(spill, "ok.txt"))).content).toBe("spill-ok\n");
    await expect(fs.read(secret)).rejects.toThrow(PathEscapeError);
    await expect(
      fs.read(path.join(spill, "..", "host-settings.json")),
    ).rejects.toThrow(PathEscapeError);

    const { symlinkSync } = await import("node:fs");
    const link = path.join(spill, "escape.txt");
    try {
      symlinkSync(secret, link);
    } catch {
      // Windows without symlink privilege — lexical denial above still covers.
      return;
    }
    await expect(fs.read(link)).rejects.toThrow(PathEscapeError);
  });
});
