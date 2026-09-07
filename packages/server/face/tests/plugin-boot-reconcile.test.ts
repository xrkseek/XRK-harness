import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reconcileClientBootAt } from "../src/plugin-boot.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("reconcileClientBootAt", () => {
  it("writes a content-stable rev and skips rewrite when entries are unchanged", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-boot-stable-"));
    temps.push(root);
    writeFileSync(
      path.join(root, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          side: {
            name: "side",
            version: "1.2.3",
            kind: "client",
            clientInject: ["@xrkseek/client-runtime"],
          },
        },
      }),
    );

    const first = reconcileClientBootAt(root);
    expect(first.wrote).toBe(true);
    expect(first.rev.startsWith("xrk-plugins-")).toBe(true);
    expect(first.entries).toHaveLength(1);
    const boot1 = readFileSync(path.join(root, "web", "boot.json"), "utf8");

    const second = reconcileClientBootAt(root);
    expect(second.wrote).toBe(false);
    expect(second.rev).toBe(first.rev);
    expect(readFileSync(path.join(root, "web", "boot.json"), "utf8")).toBe(
      boot1,
    );
  });

  it("rewrites when the enabled set changes and prunes orphan disabled ids", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-boot-change-"));
    temps.push(root);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      path.join(root, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          keep: {
            name: "keep",
            version: "1.0.0",
            kind: "client",
            clientInject: [],
          },
        },
      }),
    );
    writeFileSync(
      path.join(root, ".xrk-plugins-disabled.json"),
      `${JSON.stringify({ ids: ["keep", "ghost"] }, null, 2)}\n`,
    );

    const disabledPass = reconcileClientBootAt(root);
    expect(disabledPass.wrote).toBe(false);
    expect(existsSync(path.join(root, "web", "boot.json"))).toBe(false);
    expect(
      JSON.parse(
        readFileSync(path.join(root, ".xrk-plugins-disabled.json"), "utf8"),
      ).ids,
    ).toEqual(["keep"]);

    writeFileSync(
      path.join(root, ".xrk-plugins-disabled.json"),
      `${JSON.stringify({ ids: [] }, null, 2)}\n`,
    );
    // Empty ids file still present — reconcile should write boot now.
    rmSync(path.join(root, ".xrk-plugins-disabled.json"), { force: true });
    const enabledPass = reconcileClientBootAt(root);
    expect(enabledPass.wrote).toBe(true);
    expect(enabledPass.entries.map((e) => e.id)).toEqual(["keep"]);
  });
});
