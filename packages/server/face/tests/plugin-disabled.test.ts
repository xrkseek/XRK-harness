import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDisabledPluginIdsAt } from "@xrkseek/server-loader";
import { reconcileClientBootAt } from "../src/plugin-boot.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Face boot + soft-disable (loader leaf)", () => {
  it("reconcile drops boot when disabled via inventory key alias", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-face-boot-alias-"));
    temps.push(root);
    writeFileSync(
      path.join(root, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "key-id": {
            name: "pretty-name",
            version: "2.0.0",
            kind: "client",
            clientInject: [],
          },
        },
      }),
    );
    writeFileSync(
      path.join(root, ".xrk-plugins-disabled.json"),
      `${JSON.stringify({ ids: ["key-id"] }, null, 2)}\n`,
    );
    const result = reconcileClientBootAt(root);
    expect(result.entries).toEqual([]);
    expect(result.prunedDisabled).toBe(true);
    expect([...readDisabledPluginIdsAt(root)]).toEqual(["pretty-name"]);
  });
});
