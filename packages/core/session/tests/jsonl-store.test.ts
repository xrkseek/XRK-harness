import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createJsonlSessionStore,
  fromJSONL,
  parseJSONL,
  writeTextFileAtomicSync,
} from "../src/index.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "xrk-jsonl-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("jsonl session store", () => {
  it("persists appends and reloads", async () => {
    await withTempDir(async (dir) => {
      const a = createJsonlSessionStore(dir);
      const s = a.create("sess_a");
      a.append(s.id, {
        type: "user/message",
        ts: 1,
        turnId: "t",
        content: "hi",
      });
      const text = await readFile(path.join(dir, "sess_a.jsonl"), "utf8");
      expect(fromJSONL(text)).toHaveLength(1);

      const b = createJsonlSessionStore(dir);
      expect(b.list()).toEqual(["sess_a"]);
      expect(b.has("sess_a")).toBe(true);
      expect(b.has("nope")).toBe(false);
      expect(b.get("sess_a").events[0]).toMatchObject({
        type: "user/message",
        content: "hi",
      });
    });
  });

  it("rejects unsafe ids and missing get/append", async () => {
    await withTempDir(async (dir) => {
      const store = createJsonlSessionStore(dir);
      expect(() => store.create("../x")).toThrow(/unsafe/);
      expect(() => store.get("missing")).toThrow(/not found/);
      expect(() =>
        store.append("missing", {
          type: "user/message",
          ts: 1,
          turnId: "t",
          content: "x",
        }),
      ).toThrow(/not found/);
      store.create("dup");
      expect(() => store.create("dup")).toThrow(/already exists/);
    });
  });

  it("drops trailing incomplete line and rewrites the file", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "sess_t.jsonl");
      const good = JSON.stringify({
        type: "user/message",
        ts: 1,
        turnId: "t",
        content: "ok",
      });
      await writeFile(file, `${good}\n{"type":"assistant/mess`, "utf8");

      const parsed = parseJSONL(`${good}\n{"type":"assistant/mess`);
      expect(parsed.events).toHaveLength(1);
      expect(parsed.droppedTrailingIncomplete).toBe(true);

      const store = createJsonlSessionStore(dir);
      expect(store.has("sess_t")).toBe(true);
      expect(store.get("sess_t").events).toHaveLength(1);
      const rewritten = await readFile(file, "utf8");
      expect(rewritten).toBe(`${good}\n`);
    });
  });

  it("drops a trailing line that fails event schema and rewrites", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "sess_s.jsonl");
      const good = JSON.stringify({
        type: "user/message",
        ts: 1,
        turnId: "t",
        content: "ok",
      });
      await writeFile(
        file,
        `${good}\n{"type":"user/message","ts":2,"turnId":"t"}\n`,
        "utf8",
      );
      const store = createJsonlSessionStore(dir);
      expect(store.get("sess_s").events).toHaveLength(1);
      expect(await readFile(file, "utf8")).toBe(`${good}\n`);
    });
  });

  it("skips a mid-file corrupt session without blocking siblings", async () => {
    await withTempDir(async (dir) => {
      const good = JSON.stringify({
        type: "user/message",
        ts: 1,
        turnId: "t",
        content: "ok",
      });
      await writeFile(path.join(dir, "sess_ok.jsonl"), `${good}\n`, "utf8");
      await writeFile(
        path.join(dir, "sess_bad.jsonl"),
        `${good}\nnot-json\n${good}\n`,
        "utf8",
      );
      await writeFile(path.join(dir, "goals.json"), '{"x":1}\n', "utf8");

      const store = createJsonlSessionStore(dir);
      expect(store.list()).toEqual(["sess_ok"]);
      expect(store.has("sess_bad")).toBe(false);
    });
  });

  it("writeTextFileAtomicSync replaces an existing file", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "x.json");
      await writeFile(file, "{broken", "utf8");
      writeTextFileAtomicSync(file, '{"ok":true}\n');
      expect(await readFile(file, "utf8")).toBe('{"ok":true}\n');
    });
  });
});
