/**
 * Unit tests for DSH mobile-access Host gate primitives (network class + PIN).
 */
import { describe, expect, it } from "vitest";
import {
  classifyRequestHost,
  evaluateMobileGate,
  hostOnly,
  isMobileGateExemptPath,
} from "../src/dsh-compat/underlying/mobile-gate-kit.js";

describe("mobile-gate-kit", () => {
  it("classifies loopback / lan / wan hosts", () => {
    expect(classifyRequestHost("127.0.0.1")).toBe("loopback");
    expect(classifyRequestHost("localhost")).toBe("loopback");
    expect(classifyRequestHost("10.79.1.2")).toBe("lan");
    expect(classifyRequestHost("192.168.0.8")).toBe("lan");
    expect(classifyRequestHost("172.16.5.1")).toBe("lan");
    expect(classifyRequestHost("7e61f4ed.r6.cpolar.cn")).toBe("wan");
    expect(classifyRequestHost("example.com")).toBe("wan");
  });

  it("parses host header with port", () => {
    expect(hostOnly("10.0.0.1:8099")).toBe("10.0.0.1");
    expect(hostOnly("[::1]:8099")).toBe("::1");
  });

  it("exempts health and mobile-access surfaces", () => {
    expect(isMobileGateExemptPath("/health")).toBe(true);
    expect(isMobileGateExemptPath("/mobile-access/wan-pin")).toBe(true);
    expect(isMobileGateExemptPath("/")).toBe(false);
    expect(isMobileGateExemptPath("/plugins/x/client.js")).toBe(false);
  });

  it("requires wan pin on public hosts when mobile access is running", () => {
    const snap = {
      running: true,
      lanAuthEnabled: true,
      lanToken: "11111111",
      wanToken: "22222222",
      instanceId: "abc",
    };
    const denied = evaluateMobileGate("/", "7e61f4ed.r6.cpolar.cn", snap, {
      hasDeviceSession: false,
      hasLanPin: false,
      hasWanPin: false,
    });
    expect(denied).toEqual({
      mode: "wan",
      allowed: false,
      pinPath: "/mobile-access/wan-pin",
    });

    const ok = evaluateMobileGate("/", "7e61f4ed.r6.cpolar.cn", snap, {
      hasDeviceSession: false,
      hasLanPin: false,
      hasWanPin: true,
    });
    expect(ok.allowed).toBe(true);
    expect(ok.mode).toBe("wan");
  });

  it("requires lan pin on private LAN when lanAuthEnabled", () => {
    const snap = {
      running: true,
      lanAuthEnabled: true,
      lanToken: "11111111",
      wanToken: "22222222",
      instanceId: "abc",
    };
    const denied = evaluateMobileGate("/plugins/a.js", "10.79.1.2", snap, {
      hasDeviceSession: false,
      hasLanPin: false,
      hasWanPin: true,
    });
    expect(denied.mode).toBe("lan");
    expect(denied.allowed).toBe(false);

    const openLan = evaluateMobileGate("/", "10.79.1.2", {
      ...snap,
      lanAuthEnabled: false,
    }, {
      hasDeviceSession: false,
      hasLanPin: false,
      hasWanPin: false,
    });
    expect(openLan).toEqual({ mode: "none", allowed: true });
  });

  it("leaves loopback and stopped access ungated", () => {
    const snap = {
      running: true,
      lanAuthEnabled: true,
      lanToken: "1",
      wanToken: "2",
      instanceId: "x",
    };
    expect(
      evaluateMobileGate("/", "127.0.0.1", snap, {
        hasDeviceSession: false,
        hasLanPin: false,
        hasWanPin: false,
      }).allowed,
    ).toBe(true);
    expect(
      evaluateMobileGate("/", "example.com", { ...snap, running: false }, {
        hasDeviceSession: false,
        hasLanPin: false,
        hasWanPin: false,
      }).allowed,
    ).toBe(true);
  });
});
