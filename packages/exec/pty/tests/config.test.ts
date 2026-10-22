import { describe, expect, it } from "vitest";
import { defaultPtyBackendConfig } from "../src/config.js";
import { resolvePtyCwd } from "../src/cwd.js";
import { TerminalError } from "../src/types.js";
import path from "node:path";

describe("defaultPtyBackendConfig", () => {
  it("rejects empty backend type and inverted byte caps", () => {
    expect(() => defaultPtyBackendConfig({ backendType: "" })).toThrow(
      /backendType/,
    );
    expect(() =>
      defaultPtyBackendConfig({ maxReadBytes: 10, scrollbackMaxBytes: 5 }),
    ).toThrow(/maxReadBytes/);
  });

  it("rejects non-positive numeric fields (CV DSH validateConfig)", () => {
    expect(() => defaultPtyBackendConfig({ timeoutMs: 0 })).toThrow(
      /timeoutMs/,
    );
    expect(() => defaultPtyBackendConfig({ rows: -1 })).toThrow(/rows/);
    expect(() =>
      defaultPtyBackendConfig({ handoffGraceMs: 10, pollIntervalMs: 50 }),
    ).toThrow(/handoffGraceMs/);
  });

  it("accepts promptTailGraceMs 0 and rejects negatives / fractions", () => {
    expect(defaultPtyBackendConfig().promptTailGraceMs).toBe(0);
    expect(defaultPtyBackendConfig({ promptTailGraceMs: 0 }).promptTailGraceMs).toBe(
      0,
    );
    expect(defaultPtyBackendConfig({ promptTailGraceMs: 25 }).promptTailGraceMs).toBe(
      25,
    );
    expect(() => defaultPtyBackendConfig({ promptTailGraceMs: -1 })).toThrow(
      /promptTailGraceMs/,
    );
    expect(() => defaultPtyBackendConfig({ promptTailGraceMs: 1.5 })).toThrow(
      /promptTailGraceMs/,
    );
  });
});

describe("resolvePtyCwd", () => {
  it("defaults to the workspace root and jails user cwd", () => {
    const root = path.resolve("/ws");
    expect(resolvePtyCwd(root)).toBe(root);
    expect(resolvePtyCwd(root, "src")).toBe(path.resolve(root, "src"));
    expect(() => resolvePtyCwd(root, "..")).toThrow(TerminalError);
  });
});
