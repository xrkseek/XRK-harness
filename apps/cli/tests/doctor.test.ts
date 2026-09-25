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
    expect(names["cost-ledger"]).toBeDefined();
    expect(names["cost-ledger"]?.ok).toBe(true);
    expect(names["ssh-remote"]).toBeDefined();
    expect(names["ssh-remote"]?.detail).toMatch(/off|BatchMode|SSH/i);
    expect(names["user-home-seeds"]).toBeDefined();
    expect(names["community-plugins"]).toBeDefined();
    expect(names["sandbox-backend"]).toBeDefined();
    expect(names["sandbox-helper"]).toBeDefined();
    expect(names["web-fetch-allowlist"]).toBeDefined();
    expect(names["memory-provider"]).toBeDefined();
    expect(names["memory-provider"]?.ok).toBe(true);
    expect(names["skill-curator"]).toBeDefined();
    expect(names.voice).toBeDefined();
    expect(names.voice?.detail).toMatch(/off|memory|openai/i);
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

  it("includes im-gateway readiness (bridge · contract · mock sample)", async () => {
    const result = await runDoctor(process.cwd());
    const row = result.checks.find((c) => c.name === "im-gateway");
    expect(row).toBeDefined();
    expect(row?.ok).toBe(true);
    expect(row?.detail).toMatch(/bridge|sidecar|ws-client/);
    expect(row?.detail).toMatch(/contract/);
    expect(row?.detail).toMatch(/example-im-mock-sidecar|mock-sidecar/);
  });

  it("includes a2a-inbound readiness (Settings / env)", async () => {
    const result = await runDoctor(process.cwd());
    const row = result.checks.find((c) => c.name === "a2a-inbound");
    expect(row).toBeDefined();
    expect(row?.ok).toBe(true);
    expect(row?.detail).toMatch(/off|on/);
    expect(row?.detail).toMatch(/A2A|a2a|Face/i);
  });

  it("includes auto-review readiness (heuristic / http probe)", async () => {
    const result = await runDoctor(process.cwd());
    const row = result.checks.find((c) => c.name === "auto-review");
    expect(row).toBeDefined();
    expect(row?.ok).toBe(true);
    expect(row?.detail).toMatch(/heuristic|http/);
    expect(row?.detail).toMatch(/probe/);
  });

  it("includes a voice readiness row", async () => {
    const result = await runDoctor(process.cwd());
    const voice = result.checks.find((c) => c.name === "voice");
    expect(voice).toBeDefined();
    expect(voice?.detail).toMatch(/off|memory|openai/i);
  });
});
