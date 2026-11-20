/**
 * Host sidebar fs.mkdir / fs.delete / fs.watch.sync / fs.tree.batch.
 * Covers the mobile explorer path: folder delete must not EISDIR, absolute
 * paths must stay inside cwd, and watch/batch must exist so the client can
 * refresh after self-initiated mutations.
 */
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSidebarPublicHandler } from "../src/sidebar/index.js";

async function withWorkspace(
  run: (base: string, cwd: string) => Promise<void>,
): Promise<void> {
  const cwd = mkdtempSync(path.join(tmpdir(), "xrk-sidebar-fs-"));
  const handler = createSidebarPublicHandler({ defaultCwd: cwd });
  const server = createServer((req, res) => {
    void (async () => {
      const claimed = await handler(req, res);
      if (!claimed) {
        res.writeHead(404);
        res.end("no");
      }
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  try {
    await run(`http://127.0.0.1:${addr.port}`, cwd);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function callApi(
  base: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; value?: unknown; error?: { code?: string; message: string } }> {
  const res = await fetch(`${base}/sidebar/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await res.json()) as {
    ok: boolean;
    value?: unknown;
    error?: { code?: string; message: string };
  };
}

describe("sidebar fs mutations", () => {
  it("deletes a directory recursively (no EISDIR)", async () => {
    await withWorkspace(async (base, cwd) => {
      const dir = path.join(cwd, "呜呜呜");
      mkdirSync(dir);
      writeFileSync(path.join(dir, "note.txt"), "hi");
      const body = await callApi(base, "fs.delete", { path: dir });
      expect(body.ok).toBe(true);
      expect(existsSync(dir)).toBe(false);
    });
  });

  it("refuses to delete the workspace root", async () => {
    await withWorkspace(async (base, cwd) => {
      const body = await callApi(base, "fs.delete", { path: cwd });
      expect(body.ok).toBe(false);
      expect(body.error?.message).toMatch(/workspace root/i);
      expect(existsSync(cwd)).toBe(true);
    });
  });

  it("refuses absolute paths outside the workspace", async () => {
    await withWorkspace(async (base, cwd) => {
      const outside = mkdtempSync(path.join(tmpdir(), "xrk-sidebar-out-"));
      writeFileSync(path.join(outside, "secret.txt"), "nope");
      const body = await callApi(base, "fs.write", {
        path: path.join(outside, "secret.txt"),
        content: "pwned",
      });
      expect(body.ok).toBe(false);
      expect(readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("nope");
      // cwd itself must remain writable
      const okWrite = await callApi(base, "fs.write", {
        path: path.join(cwd, "ok.txt"),
        content: "yes",
      });
      expect(okWrite.ok).toBe(true);
    });
  });

  it("fs.read previews absolute paths outside the workspace (chat wake)", async () => {
    await withWorkspace(async (base, cwd) => {
      const outside = mkdtempSync(path.join(tmpdir(), "xrk-sidebar-read-"));
      const file = path.join(outside, "notes.txt");
      writeFileSync(file, "hello outside");
      const body = await callApi(base, "fs.read", { path: file });
      expect(body.ok).toBe(true);
      const value = body.value as { kind: string; content?: string };
      expect(value.kind).toBe("text");
      expect(value.content).toBe("hello outside");
      // Relative escape (`../…`) still refused — only absolute outsides preview.
      const viaDotDot = await callApi(base, "fs.read", {
        path: path.join("..", path.basename(outside), "notes.txt"),
      });
      expect(viaDotDot.ok).toBe(false);
      expect(viaDotDot.error?.code).toBe("path");
      expect(viaDotDot.error?.message).toMatch(/escapes workspace/i);

      const empty = await callApi(base, "fs.read", { path: "   " });
      expect(empty.ok).toBe(false);
      expect(empty.error?.code).toBe("empty");

      const missing = await callApi(base, "fs.read", {
        path: path.join(cwd, "no-such-file.txt"),
      });
      expect(missing.ok).toBe(false);
      expect(missing.error?.code).toBe("not-found");
    });
  });

  it("fs.stat reports absolute paths outside the workspace", async () => {
    await withWorkspace(async (base) => {
      const outside = mkdtempSync(path.join(tmpdir(), "xrk-sidebar-stat-"));
      const file = path.join(outside, "blob.bin");
      writeFileSync(file, "abc");
      const body = await callApi(base, "fs.stat", { path: file });
      expect(body.ok).toBe(true);
      const value = body.value as { isFile: boolean; size: number };
      expect(value.isFile).toBe(true);
      expect(value.size).toBe(3);
    });
  });

  it("ignores cwd override that escapes the session workspace", async () => {
    await withWorkspace(async (base, cwd) => {
      const outside = mkdtempSync(path.join(tmpdir(), "xrk-sidebar-cwd-"));
      writeFileSync(path.join(outside, "secret.txt"), "nope");
      const body = await callApi(base, "fs.write", {
        cwd: outside,
        path: path.join(outside, "secret.txt"),
        content: "pwned",
      });
      expect(body.ok).toBe(false);
      expect(readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("nope");
      // Subdir under session cwd is still allowed as an override.
      const nested = path.join(cwd, "nested");
      mkdirSync(nested);
      const okNested = await callApi(base, "fs.write", {
        cwd: nested,
        path: path.join(nested, "ok.txt"),
        content: "yes",
      });
      expect(okNested.ok).toBe(true);
      expect(readFileSync(path.join(nested, "ok.txt"), "utf8")).toBe("yes");
    });
  });

  it("fs.write keeps absolute chat-woken paths under the session root when cwd is a nested explorer override", async () => {
    await withWorkspace(async (base, cwd) => {
      const note = path.join(cwd, "notes.md");
      writeFileSync(note, "# old\n");
      const nested = path.join(cwd, "nested");
      mkdirSync(nested);
      // Editor tab path is absolute (chat open); explorer scope.cwd may be a subdir.
      const body = await callApi(base, "fs.write", {
        cwd: nested,
        path: note,
        content: "# saved\n",
      });
      expect(body.ok).toBe(true);
      expect(readFileSync(note, "utf8")).toBe("# saved\n");
    });
  });

  it("refuses JSON upload to absolute paths outside the workspace", async () => {
    await withWorkspace(async (base) => {
      const outside = mkdtempSync(path.join(tmpdir(), "xrk-sidebar-up-"));
      const target = path.join(outside, "pwned.txt");
      writeFileSync(target, "safe");
      const res = await fetch(`${base}/sidebar/upload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: target, content: "pwned" }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        error?: { message?: string };
      };
      expect(body.ok).toBe(false);
      expect(body.error?.message).toMatch(/escapes workspace/i);
      expect(readFileSync(target, "utf8")).toBe("safe");
    });
  });

  it("refuses open.external url with non-http(s) schemes", async () => {
    await withWorkspace(async (base) => {
      const body = await callApi(base, "open.external", {
        action: "url",
        url: "file:///etc/passwd",
      });
      expect(body.ok).toBe(false);
      expect(body.error?.message).toMatch(/http\(s\)/i);
    });
  });

  it("fs.watch.sync marks levels unwatched for degraded polling", async () => {
    await withWorkspace(async (base, cwd) => {
      mkdirSync(path.join(cwd, "src"));
      const body = await callApi(base, "fs.watch.sync", {
        dirs: [cwd, path.join(cwd, "src")],
        since: 0,
        subscriber: "test",
      });
      expect(body.ok).toBe(true);
      const value = body.value as {
        unwatched: string[];
        changed: string[];
        missed: boolean;
      };
      expect(value.missed).toBe(false);
      expect(value.changed).toEqual([]);
      expect(value.unwatched).toContain(cwd);
      expect(value.unwatched).toContain(path.join(cwd, "src"));
    });
  });

  it("fs.tree.batch re-lists directories after mkdir", async () => {
    await withWorkspace(async (base, cwd) => {
      const mkdirBody = await callApi(base, "fs.mkdir", {
        path: path.join(cwd, "assets"),
      });
      expect(mkdirBody.ok).toBe(true);
      const batch = await callApi(base, "fs.tree.batch", {
        paths: [cwd],
        statPaths: [],
      });
      expect(batch.ok).toBe(true);
      const value = batch.value as {
        listings: Array<{
          path: string;
          entries?: Array<{ name: string; isDir?: boolean }>;
        }>;
      };
      const listing = value.listings[0];
      expect(listing?.path).toBe(cwd);
      expect(listing?.entries?.some((row) => row.name === "assets" && row.isDir)).toBe(
        true,
      );
    });
  });
});
