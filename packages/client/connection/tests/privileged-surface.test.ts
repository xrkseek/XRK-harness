/** Privileged-surface helpers (loopback + Desktop ownsHost / xrk-app). */

import { describe, expect, it } from "vitest";
import {
  isLoopbackHostname,
  isPrivilegedClientSurface,
} from "../src/loopback-hostname.ts";

describe("isLoopbackHostname", () => {
  it("accepts localhost, IPv6 loopback, and the whole IPv4 127/8 block", () => {
    for (const hostname of [
      "localhost",
      "[::1]",
      "127.0.0.1",
      "127.8.9.10",
      "127.255.255.255",
    ]) {
      expect(isLoopbackHostname(hostname)).toBe(true);
    }
  });

  it("refuses malformed and non-loopback hostnames", () => {
    for (const hostname of [
      "remote.localhost",
      "::1",
      "128.0.0.1",
      "127.0.0",
      "127.0.0.256",
      "127.0.0.-1",
    ]) {
      expect(isLoopbackHostname(hostname)).toBe(false);
    }
  });
});

describe("isPrivilegedClientSurface", () => {
  it("treats Desktop ownsHost and xrk-app pages as privileged", () => {
    expect(
      isPrivilegedClientSurface({
        ownsHost: true,
        pageLocation: { hostname: "192.0.2.20" },
      }),
    ).toBe(true);
    expect(
      isPrivilegedClientSurface({
        pageLocation: { hostname: "app", protocol: "xrk-app:" },
      }),
    ).toBe(true);
  });

  it("keeps remote http host non-privileged without ownsHost", () => {
    expect(
      isPrivilegedClientSurface({
        pageLocation: { hostname: "192.0.2.20", protocol: "https:" },
      }),
    ).toBe(false);
  });
});
