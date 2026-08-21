import { describe, expect, it } from "vitest";
import { looksLikeXrkHostCommand } from "../src/port.js";
import {
  clearHostLock,
  hostLockPath,
  readHostLock,
  writeHostLock,
} from "../src/host-lock.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("looksLikeXrkHostCommand", () => {
  it("accepts known Host fingerprints", () => {
    expect(looksLikeXrkHostCommand("node apps/cli/dist/bin.js web")).toBe(true);
    expect(looksLikeXrkHostCommand("C:\\npm\\xrk-harness.cmd web")).toBe(true);
    expect(
      looksLikeXrkHostCommand("node .../@xrkseek/harness-cli/dist/bin.js serve"),
    ).toBe(true);
  });

  it("rejects unrelated listeners", () => {
    expect(looksLikeXrkHostCommand("C:\\nginx\\nginx.exe")).toBe(false);
    expect(looksLikeXrkHostCommand("node server.js")).toBe(false);
    expect(looksLikeXrkHostCommand("")).toBe(false);
  });
});

describe("host lock", () => {
  it("round-trips under a temp XRK_HOME", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "xrk-lock-"));
    const env = { ...process.env, XRK_HOME: home };
    try {
      const rec = writeHostLock(8787, env);
      expect(rec.pid).toBe(process.pid);
      expect(readHostLock(8787, env)?.pid).toBe(process.pid);
      expect(fs.existsSync(hostLockPath(8787, env))).toBe(true);
      clearHostLock(8787, env);
      expect(readHostLock(8787, env)).toBeNull();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
