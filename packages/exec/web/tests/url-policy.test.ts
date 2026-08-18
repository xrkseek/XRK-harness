import { describe, expect, it } from "vitest";
import { WebError } from "../src/types.js";
import {
  assertHttpUrl,
  isBlockedHost,
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
});
