import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeTextFileAtomicSync } from "../src/index.js";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop()!, { recursive: true, force: true });
  }
});

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "xrk-atomic-"));
  dirs.push(dir);
  await run(dir);
}

describe("writeTextFileAtomicSync", () => {
  it("replaces an existing file", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "x.json");
      await writeFile(file, "{broken", "utf8");
      writeTextFileAtomicSync(file, '{"ok":true}\n');
      expect(await readFile(file, "utf8")).toBe('{"ok":true}\n');
    });
  });
});
