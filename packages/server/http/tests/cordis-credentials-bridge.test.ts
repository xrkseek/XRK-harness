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
    expect(hit?.source).toBe("local");

    const b = createCordisCredentialsBridge(home, "dsh-our-free-model");
    const again = await b.resolve("CODEARTS_ACCOUNT_1");
    expect(again?.value).toContain("t1");
  });

  it("describe reports configured; unset clears (channel-pack logout)", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "cred-describe-"));
    temps.push(home);
    const store = createCordisCredentialsBridge(home, "dsh-our-free-model");
    expect(await store.describe("TRAE_ACCOUNT")).toEqual({
      configured: false,
      writable: true,
    });
    await store.set("TRAE_ACCOUNT", JSON.stringify({ access: "a1" }));
    expect(await store.describe("TRAE_ACCOUNT")).toEqual({
      configured: true,
      source: "local",
      writable: true,
    });
    await store.unset("TRAE_ACCOUNT");
    expect(await store.describe("TRAE_ACCOUNT")).toEqual({
      configured: false,
      writable: true,
    });
    expect(await store.resolve("TRAE_ACCOUNT")).toBeUndefined();
  });

  it("rejects path-like refs", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "cred-bad-"));
    temps.push(home);
    const store = createCordisCredentialsBridge(home, "pkg");
    await expect(store.set("../escape", "x")).rejects.toThrow(/invalid/);
  });
});
