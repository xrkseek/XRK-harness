import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCordisCredentialsBridge } from "../src/dsh-compat/cordis-credentials-bridge.js";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("cordis-credentials-bridge", () => {
  it("persists resolve/set across bridge instances", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "cred-bridge-"));
    temps.push(home);
    const a = createCordisCredentialsBridge(home, "dsh-our-free-model");
    await a.set("CODEARTS_ACCOUNT_1", JSON.stringify({ access_token: "t1" }));
    const hit = await a.resolve("CODEARTS_ACCOUNT_1");
    expect(hit?.value).toContain("t1");

    const b = createCordisCredentialsBridge(home, "dsh-our-free-model");
    const again = await b.resolve("CODEARTS_ACCOUNT_1");
    expect(again?.value).toContain("t1");
  });

  it("rejects path-like refs", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "cred-bad-"));
    temps.push(home);
    const store = createCordisCredentialsBridge(home, "pkg");
    await expect(store.set("../escape", "x")).rejects.toThrow(/invalid/);
  });
});
