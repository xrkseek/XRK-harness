/** Privileged-surface helpers (loopback + Desktop ownsHost / xrk-app / PIN). */

import { afterEach, describe, expect, it } from "vitest";
import {
  isLoopbackHostname,
  isPrivateLanHostname,
  isPrivilegedClientSurface,
  OPERATOR_ACCESS_STORAGE_KEY,
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

describe("isPrivateLanHostname", () => {
  it("accepts RFC1918 and link-local literals", () => {
    expect(isPrivateLanHostname("10.79.42.51")).toBe(true);
    expect(isPrivateLanHostname("192.168.1.5")).toBe(true);
    expect(isPrivateLanHostname("172.16.0.1")).toBe(true);
    expect(isPrivateLanHostname("169.254.1.1")).toBe(true);
  });

  it("refuses public and malformed hosts", () => {
    expect(isPrivateLanHostname("192.0.2.20")).toBe(false);
    expect(isPrivateLanHostname("example.com")).toBe(false);
    expect(isPrivateLanHostname("10.1")).toBe(false);
  });
});

describe("isPrivilegedClientSurface", () => {
  afterEach(() => {
    try {
      sessionStorage.removeItem(OPERATOR_ACCESS_STORAGE_KEY);
    } catch {
      /* jsdom may lack storage */
    }
  });

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

  it("treats private LAN pages as privileged", () => {
    expect(
      isPrivilegedClientSurface({
        pageLocation: { hostname: "10.79.42.51", protocol: "http:" },
      }),
    ).toBe(true);
  });

  it("keeps remote http host non-privileged without ownsHost or PIN", () => {
    expect(
      isPrivilegedClientSurface({
        pageLocation: { hostname: "192.0.2.20", protocol: "https:" },
      }),
    ).toBe(false);
  });

  it("elevates after PIN sessionStorage flag", () => {
    try {
      sessionStorage.setItem(OPERATOR_ACCESS_STORAGE_KEY, "1");
    } catch {
      return;
    }
    expect(
      isPrivilegedClientSurface({
        pageLocation: { hostname: "example.com", protocol: "https:" },
      }),
    ).toBe(true);
  });
});
