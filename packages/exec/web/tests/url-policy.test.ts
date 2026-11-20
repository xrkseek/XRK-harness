import { describe, expect, it } from "vitest";
import { WebError } from "../src/types.js";
import {
  assertHttpUrl,
  assertResolvedAddressesPublic,
  isBlockedHost,
  isIpLiteralHostname,
  isSameOrigin,
} from "../src/url-policy.js";

describe("url policy", () => {
  it("accepts public http(s) URLs", () => {
    expect(assertHttpUrl("https://example.com/a", 2048).hostname).toBe(
      "example.com",
    );
  });

  it("rejects credentials, non-http, and over-long URLs", () => {
    expect(() => assertHttpUrl("ftp://example.com", 2048)).toThrow(WebError);
    expect(() =>
      assertHttpUrl("https://user:pass@example.com", 2048),
    ).toThrow(/credentials/);
    expect(() => assertHttpUrl("https://example.com/" + "x".repeat(3000), 2048)).toThrow(
      /exceeds/,
    );
  });

  it("blocks literal loopback, RFC1918, and link-local hosts", () => {
    expect(isBlockedHost("localhost")).toBe(true);
    expect(isBlockedHost("127.0.0.1")).toBe(true);
    expect(isBlockedHost("10.0.0.1")).toBe(true);
    expect(isBlockedHost("192.168.1.1")).toBe(true);
    expect(isBlockedHost("172.16.0.1")).toBe(true);
    expect(isBlockedHost("169.254.1.1")).toBe(true);
    expect(isBlockedHost("::1")).toBe(true);
    expect(isBlockedHost("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedHost("example.com")).toBe(false);
    expect(isBlockedHost("172.32.0.1")).toBe(false);
    expect(() => assertHttpUrl("http://127.0.0.1/", 2048)).toThrow(/private-network/);
  });

  it("same-origin includes scheme and host:port", () => {
    const a = new URL("https://example.com:443/a");
    const b = new URL("https://example.com/b");
    expect(isSameOrigin(a, b)).toBe(true);
    expect(isSameOrigin(a, new URL("https://other.example/"))).toBe(false);
  });

  it("detects IP literal hostnames", () => {
    expect(isIpLiteralHostname("203.0.113.1")).toBe(true);
    expect(isIpLiteralHostname("[2001:db8::1]")).toBe(true);
    expect(isIpLiteralHostname("example.com")).toBe(false);
  });

  it("DNS rebinding: denies names that resolve to private addresses", async () => {
    const url = new URL("https://evil.example/");
    await expect(
      assertResolvedAddressesPublic(url, {
        lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      }),
    ).rejects.toThrow(/private-network|127\.0\.0\.1/);
    await expect(
      assertResolvedAddressesPublic(url, {
        lookup: async () => [{ address: "10.1.2.3", family: 4 }],
      }),
    ).rejects.toThrow(/10\.1\.2\.3/);
  });

  it("DNS rebinding: allows public resolved addresses", async () => {
    const url = new URL("https://example.com/");
    await expect(
      assertResolvedAddressesPublic(url, {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      }),
    ).resolves.toBeUndefined();
  });

  it("DNS rebinding: skips IP literals and checkPrivate=false", async () => {
    await expect(
      assertResolvedAddressesPublic(new URL("https://203.0.113.9/"), {
        lookup: async () => {
          throw new Error("should not lookup literals");
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertResolvedAddressesPublic(new URL("https://evil.example/"), {
        checkPrivate: false,
        lookup: async () => {
          throw new Error("should not lookup when disabled");
        },
      }),
    ).resolves.toBeUndefined();
  });
});
