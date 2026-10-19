import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PathEscapeError } from "../src/paths.js";
import { openNoFollowRead, readFileNoFollow } from "../src/open-nofollow.js";

describe("openNoFollowRead", () => {
  it("reads a regular file and keeps the handle until closed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-nofollow-"));
    const file = path.join(dir, "a.txt");
    await writeFile(file, "hello", "utf8");
    const fh = await openNoFollowRead(file, [dir]);
    try {
      const buf = Buffer.alloc(5);
      const { bytesRead } = await fh.read(buf, 0, 5, 0);
      expect(bytesRead).toBe(5);
      expect(buf.toString("utf8")).toBe("hello");
    } finally {
      await fh.close();
    }
  });

  it("rejects a symlink whose target leaves the jail roots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-nf-root-"));
    const outside = await mkdtemp(path.join(tmpdir(), "xrk-nf-out-"));
    const secret = path.join(outside, "secret.txt");
    await writeFile(secret, "nope", "utf8");
    const link = path.join(root, "escape.txt");
    try {
      symlinkSync(secret, link);
    } catch {
      return;
    }
    await expect(openNoFollowRead(link, [root])).rejects.toBeInstanceOf(
      PathEscapeError,
    );
    await expect(readFileNoFollow(link, [root])).rejects.toThrow(/symlink/);
  });

  it("rejects a dangling symlink", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-nf-dang-"));
    const link = path.join(root, "gone.txt");
    try {
      symlinkSync(path.join(root, "missing.txt"), link);
    } catch {
      return;
    }
    await expect(openNoFollowRead(link, [root])).rejects.toBeInstanceOf(
      PathEscapeError,
    );
  });

  it("rejects directories", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-nf-dir-"));
    const dir = path.join(root, "sub");
    await mkdir(dir);
    await expect(openNoFollowRead(dir, [root])).rejects.toThrow(/EISDIR/);
  });

  it("follows an in-root symlink after realpath", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-nf-in-"));
    const target = path.join(root, "t.txt");
    await writeFile(target, "ok", "utf8");
    const link = path.join(root, "l.txt");
    try {
      symlinkSync(target, link);
    } catch {
      return;
    }
    expect(await readFileNoFollow(link, [root])).toBe("ok");
  });

  it("allows a symlink when no jail roots are supplied (open mode)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-nf-open-"));
    const outside = await mkdtemp(path.join(tmpdir(), "xrk-nf-open-out-"));
    const secret = path.join(outside, "secret.txt");
    await writeFile(secret, "visible", "utf8");
    const link = path.join(root, "out.txt");
    try {
      symlinkSync(secret, link);
    } catch {
      return;
    }
    expect(await readFileNoFollow(link, [])).toBe("visible");
  });
});
