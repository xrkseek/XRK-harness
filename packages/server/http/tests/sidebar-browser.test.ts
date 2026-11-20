import { describe, expect, it } from "vitest";
import { probeBrowserUrl } from "../src/sidebar/sidebar-browser.js";

describe("probeBrowserUrl", () => {
  it("rejects empty / invalid / non-http schemes", async () => {
    expect(await probeBrowserUrl("")).toMatchObject({
      reachable: false,
      supported: false,
      reason: "empty-url",
    });
    expect(await probeBrowserUrl("not a url")).toMatchObject({
      reason: "invalid-url",
    });
    expect(await probeBrowserUrl("file:///etc/passwd")).toMatchObject({
      reason: "unsupported-scheme",
    });
  });

  it("blocks loopback and private literal hosts (SSRF)", async () => {
    expect(await probeBrowserUrl("http://127.0.0.1/")).toMatchObject({
      reachable: false,
      supported: false,
      reason: "blocked-host",
    });
    expect(await probeBrowserUrl("http://localhost:9460/")).toMatchObject({
      reason: "blocked-host",
    });
    expect(await probeBrowserUrl("http://192.168.1.1/")).toMatchObject({
      reason: "blocked-host",
    });
    expect(await probeBrowserUrl("http://10.0.0.5/probe")).toMatchObject({
      reason: "blocked-host",
    });
    expect(
      await probeBrowserUrl("http://user:pass@example.com/"),
    ).toMatchObject({
      reason: "credentials-in-url",
    });
  });
});
