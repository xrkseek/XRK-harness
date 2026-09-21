/** Policy JSON file watch → reload through the same load path Host uses. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { watchPolicyFile } from "../src/policy-file-watch.js";

const temps: string[] = [];

afterEach(() => {
  for (const handle of handles) handle.dispose();
  handles.length = 0;
});

const handles: Array<{ dispose(): void }> = [];

describe("watchPolicyFile", () => {
  it("reloads on change and keeps prior rules when load fails", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-policy-watch-"));
    temps.push(dir);
    const filePath = path.join(dir, "policy.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        rules: [{ id: "deny-a", action: "deny", match: { kind: "tool.call", names: ["a"] } }],
      }),
    );

    const loads: string[] = [];
    const reloads: unknown[] = [];
    const errors: unknown[] = [];
    const load = vi.fn(async (p: string) => {
      loads.push(p);
      const text = await import("node:fs/promises").then((fs) =>
        fs.readFile(p, "utf8"),
      );
      const raw = JSON.parse(text) as {
        rules: Array<{ id: string }>;
      };
      if (raw.rules[0]?.id === "bad") {
        throw new Error("invalid ruleset");
      }
      return { rules: raw.rules };
    });

    const handle = watchPolicyFile({
      filePath,
      debounceMs: 30,
      load,
      onReload: (file) => {
        reloads.push(file);
      },
      onError: (err) => {
        errors.push(err);
      },
    });
    handles.push(handle);

    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        rules: [{ id: "deny-b", action: "deny", match: { kind: "tool.call", names: ["b"] } }],
      }),
    );
    await vi.waitFor(() => {
      expect(reloads.length).toBeGreaterThanOrEqual(1);
    });
    expect(reloads.at(-1)).toEqual({
      rules: [{ id: "deny-b", action: "deny", match: { kind: "tool.call", names: ["b"] } }],
    });

    const beforeErr = reloads.length;
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        rules: [{ id: "bad", action: "deny", match: { kind: "tool.call", names: ["x"] } }],
      }),
    );
    await vi.waitFor(() => {
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });
    expect(reloads.length).toBe(beforeErr);
    expect(String(errors.at(-1))).toMatch(/invalid ruleset/);
  });

  it("dispose stops further reloads", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-policy-watch-"));
    const filePath = path.join(dir, "policy.json");
    writeFileSync(filePath, JSON.stringify({ version: 1, rules: [] }));
    let count = 0;
    const handle = watchPolicyFile({
      filePath,
      debounceMs: 20,
      load: async () => {
        count += 1;
        return { rules: [] };
      },
      onReload: () => {},
    });
    handle.dispose();
    writeFileSync(filePath, JSON.stringify({ version: 1, rules: [{ id: "x" }] }));
    await new Promise((r) => setTimeout(r, 80));
    expect(count).toBe(0);
  });
});
