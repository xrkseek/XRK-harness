import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  curatedMemoryDirFor,
  createLayeredCuratedMemoryStore,
  createScopedCuratedMemoryTools,
} from "../src/index.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("curated memory scopes", () => {
  it("places workspace / session / agent under memories/", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-mem-home-"));
    temps.push(home);
    const env = { XRK_HOME: home };
    expect(curatedMemoryDirFor("global", { env })).toBe(
      path.join(home, "memories"),
    );
    expect(curatedMemoryDirFor("workspace", { env, workspaceId: "ws_a" })).toBe(
      path.join(home, "memories", "workspaces", "ws_a"),
    );
    expect(curatedMemoryDirFor("session", { env, sessionId: "s1" })).toBe(
      path.join(home, "memories", "sessions", "s1"),
    );
    expect(curatedMemoryDirFor("agent", { env, agentId: "mem_seed_x" })).toBe(
      path.join(home, "memories", "agents", "mem_seed_x"),
    );
  });

  it("layers freeze independently and tool scope routes writes", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-mem-layer-"));
    temps.push(home);
    const env = { XRK_HOME: home };
    const layered = createLayeredCuratedMemoryStore({
      env,
      sessionId: "sess-1",
      workspaceId: "ws_code",
      agentId: "worker_a",
      defaultScope: "session",
    });
    expect(layered.layers.map((l) => l.scope).sort()).toEqual([
      "agent",
      "global",
      "session",
      "workspace",
    ]);

    const [tool] = createScopedCuratedMemoryTools(layered);
    const out = await tool!.execute({
      target: "memory",
      action: "add",
      content: "session-only fact",
      scope: "session",
    });
    expect(out.isError).toBeFalsy();
    const sessionFile = path.join(
      home,
      "memories",
      "sessions",
      "sess-1",
      "MEMORY.md",
    );
    expect(
      (await import("node:fs")).readFileSync(sessionFile, "utf8"),
    ).toContain("session-only fact");

    mkdirSync(path.join(home, "memories", "agents", "worker_a"), {
      recursive: true,
    });
    writeFileSync(
      path.join(home, "memories", "agents", "worker_a", "MEMORY.md"),
      "agent private note",
      "utf8",
    );
    const agentLayer = createLayeredCuratedMemoryStore({
      env,
      sessionId: "sess-1",
      workspaceId: "ws_code",
      agentId: "worker_a",
    });
    const frozen = agentLayer.frozenSystemBlock();
    expect(frozen).toMatch(/AGENT curated memory/);
    expect(frozen).toContain("agent private note");
  });
});
