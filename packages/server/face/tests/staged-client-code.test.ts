import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readStagedClientCode } from "../src/handlers/staged-client-code.js";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("staged-client-code", () => {
  it("reads client.js from pluginsDir layout", () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), "xrk-plugins-"));
    temps.push(pluginsDir);
    const root = path.join(pluginsDir, "web", "plugins", "dsh", "demo");
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, "client.js"), "export default {};", "utf8");

    const staged = readStagedClientCode(pluginsDir, "dsh/demo");
    expect(staged.name).toBe("client.js");
    expect(staged.code).toContain("export default");
  });
});
