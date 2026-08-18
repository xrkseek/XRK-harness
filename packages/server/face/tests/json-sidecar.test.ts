import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tryWriteJsonSidecar, writeJsonSidecar } from "../src/json-sidecar.js";

describe("json sidecar", () => {
  it("replaces the destination atomically", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sidecar-"));
    const file = path.join(dir, "goals.json");
    writeFileSync(file, "{broken", "utf8");
    writeJsonSidecar(file, { goals: { a: 1 } });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ goals: { a: 1 } });
  });

  it("tryWrite swallows persist errors", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sidecar-"));
    const blocker = path.join(dir, "not-a-dir");
    writeFileSync(blocker, "x", "utf8");
    expect(() =>
      tryWriteJsonSidecar(path.join(blocker, "nested.json"), { x: 1 }),
    ).not.toThrow();
  });
});
