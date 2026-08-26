import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runDoctor } from "../src/commands/doctor.js";

describe("cli doctor", () => {
  it("passes node + workspace in this repo", async () => {
    const result = await runDoctor(process.cwd());
    const names = Object.fromEntries(result.checks.map((c) => [c.name, c]));
    expect(names.node?.ok).toBe(true);
    expect(names.node?.detail).toMatch(/need >=26/);
    expect(names.workspace?.ok).toBe(true);
    expect(names["product-ui"]).toBeDefined();
    expect(names["product-ui"]?.detail).not.toMatch(/Face console/i);
    expect(names["xrk-home"]).toBeDefined();
    expect(names["community-plugins"]).toBeDefined();
    expect(result.ok).toBe(true);
  });

  it("fails when workspace is missing", async () => {
    const missing = path.join(os.tmpdir(), "xrk-no-such-ws-" + Date.now());
    const result = await runDoctor(missing);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "workspace")?.ok).toBe(false);
  });

  it("accepts a plain directory as workspace", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "xrk-doc-"));
    try {
      const result = await runDoctor(dir);
      expect(result.checks.find((c) => c.name === "workspace")?.ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
