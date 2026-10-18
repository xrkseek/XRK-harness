/**
 * Every agent-loop Settings field must be read by Host or Face.
 * A schema key that never appears in those readers is a dead control.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FACE = path.join(import.meta.dirname, "../src");
const HOST = path.join(import.meta.dirname, "../../host/src/index.ts");

function agentLoopKeys(): string[] {
  const src = readFileSync(path.join(FACE, "settings-schemas.ts"), "utf8");
  const block = src.match(
    /const AgentLoopConfig = Schema\.object\(\{([\s\S]*?)\n\}\);/,
  );
  if (!block?.[1]) throw new Error("AgentLoopConfig block missing");
  return [...block[1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]!);
}

describe("agent-loop settings are consumed", () => {
  it("each AgentLoopConfig field is read by Host or the Face route that owns it", () => {
    const readers = [
      readFileSync(HOST, "utf8"),
      readFileSync(path.join(FACE, "model-session-cap.ts"), "utf8"),
      readFileSync(path.join(FACE, "model-catalog.ts"), "utf8"),
      readFileSync(path.join(FACE, "subagent-tools.ts"), "utf8"),
    ].join("\n");
    const keys = agentLoopKeys();
    expect(keys.length).toBeGreaterThanOrEqual(14);
    const missing = keys.filter((key) => !readers.includes(key));
    expect(missing).toEqual([]);
  });

  it("permission defaultPreset and extraWritableRoots are read outside the schema", () => {
    const readers = [
      readFileSync(path.join(FACE, "settings-credentials.ts"), "utf8"),
      readFileSync(HOST, "utf8"),
    ].join("\n");
    expect(readers).toContain("defaultPreset");
    expect(readers).toContain("extraWritableRoots");
  });
});
