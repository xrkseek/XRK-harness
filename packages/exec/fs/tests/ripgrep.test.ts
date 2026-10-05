import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildGlobCommand,
  buildGrepCommand,
  clearRgPathCache,
  createFsLocalProvider,
  parseGrepMatches,
  preferJsSearch,
  resolveRgPath,
} from "../src/index.js";

describe("ripgrep-backed fs search", () => {
  afterEach(() => {
    clearRgPathCache();
    delete process.env.XRK_FS_SEARCH;
  });

  it("buildGlobCommand keeps VCS + heavy excludes and scopes behind --", () => {
    const argv = buildGlobCommand({ pattern: "**/*.ts", path: "src" });
    expect(argv[0]).toBe("--no-config");
    expect(argv).toContain("--files");
    expect(argv).toContain("--glob=**/*.ts");
    expect(argv).toContain("--glob=!**/.git");
    expect(argv).toContain("--glob=!**/node_modules");
    expect(argv.at(-2)).toBe("--");
    expect(argv.at(-1)).toBe("src");
  });

  it("buildGrepCommand uses --json and flag=value patterns", () => {
    const argv = buildGrepCommand({
      pattern: "TODO",
      glob: "*.ts",
      caseInsensitive: true,
      path: "pkg",
    });
    expect(argv).toContain("--json");
    expect(argv).toContain("--regexp=TODO");
    expect(argv).toContain("--ignore-case");
    expect(argv).toContain("--glob=*.ts");
    expect(argv.at(-1)).toBe("pkg");
  });

  it("parseGrepMatches reads rg --json match records", () => {
    const stdout = [
      JSON.stringify({
        type: "match",
        data: {
          path: { text: "a.ts" },
          line_number: 3,
          lines: { text: "const x = 1\n" },
        },
      }),
      JSON.stringify({ type: "summary", data: {} }),
      "",
    ].join("\n");
    expect(parseGrepMatches(stdout)).toEqual([
      { path: "a.ts", line: 3, text: "const x = 1" },
    ]);
  });

  it("resolves packaged ripgrep and finds a late-sorted file", async () => {
    if (preferJsSearch()) return;
    const bin = await resolveRgPath();
    expect(bin.length).toBeGreaterThan(0);

    const root = await mkdtemp(path.join(tmpdir(), "xrk-rg-"));
    await mkdir(path.join(root, "bulk"), { recursive: true });
    for (let i = 0; i < 200; i += 1) {
      await writeFile(path.join(root, "bulk", `f${i}.txt`), "x\n", "utf8");
    }
    await writeFile(path.join(root, "bulk", "zz-target.md"), "needle-here\n", "utf8");
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "node_modules", "pkg", "skip.ts"),
      "needle-here\n",
      "utf8",
    );

    const fs = createFsLocalProvider({ root });
    expect(await fs.glob("bulk/*.md")).toEqual(["bulk/zz-target.md"]);
    expect(await fs.grep("needle-here")).toEqual([
      { path: "bulk/zz-target.md", line: 1, text: "needle-here" },
    ]);
  });

  it("XRK_FS_SEARCH=js forces the in-process walk", async () => {
    process.env.XRK_FS_SEARCH = "js";
    const root = await mkdtemp(path.join(tmpdir(), "xrk-rg-js-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "a.ts"), "const walk = 1;\n", "utf8");
    const fs = createFsLocalProvider({ root });
    expect(await fs.grep("walk")).toEqual([
      { path: "src/a.ts", line: 1, text: "const walk = 1;" },
    ]);
  });
});
