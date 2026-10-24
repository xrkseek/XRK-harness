import { describe, expect, it } from "vitest";
import {
  fetchForOutboundProxy,
  parseOutboundProxyField,
  resolveOutboundProxyPreference,
} from "../src/llm-outbound-proxy.js";

describe("parseOutboundProxyField", () => {
  it("treats omit / null as unset", () => {
    expect(parseOutboundProxyField(undefined)).toBeUndefined();
    expect(parseOutboundProxyField(null)).toBeUndefined();
    expect(parseOutboundProxyField(1)).toBeUndefined();
  });

  it("maps direct tokens to force-no-proxy", () => {
    for (const token of ["", "direct", "none", "-", "off", "false", " DIRECT "]) {
      expect(parseOutboundProxyField(token)).toEqual({ kind: "direct" });
    }
  });

  it("accepts http(s) proxy URLs", () => {
    expect(parseOutboundProxyField("http://127.0.0.1:7890")).toEqual({
      kind: "url",
      url: "http://127.0.0.1:7890",
    });
    expect(parseOutboundProxyField("  https://proxy.example:8443  ")).toEqual({
      kind: "url",
      url: "https://proxy.example:8443",
    });
  });

  it("rejects non-http proxy schemes", () => {
    expect(parseOutboundProxyField("socks5://127.0.0.1:1080")).toBeUndefined();
    expect(parseOutboundProxyField("not-a-url")).toBeUndefined();
  });
});

describe("resolveOutboundProxyPreference", () => {
  it("prefers model over provider", () => {
    expect(
      resolveOutboundProxyPreference(
        "http://model:1",
        "http://provider:1",
      ),
    ).toEqual({ kind: "url", url: "http://model:1" });
    expect(resolveOutboundProxyPreference("direct", "http://provider:1")).toEqual({
      kind: "direct",
    });
  });

  it("falls back to provider then inherit", () => {
    expect(resolveOutboundProxyPreference(undefined, "http://provider:1")).toEqual({
      kind: "url",
      url: "http://provider:1",
    });
    expect(resolveOutboundProxyPreference(undefined, undefined)).toEqual({
      kind: "inherit",
    });
  });
});

describe("fetchForOutboundProxy", () => {
  it("returns undefined for inherit so Host env proxy stays in play", () => {
    expect(fetchForOutboundProxy({ kind: "inherit" })).toBeUndefined();
  });

  it("returns a bound fetch for direct and url preferences", () => {
    expect(typeof fetchForOutboundProxy({ kind: "direct" })).toBe("function");
    expect(
      typeof fetchForOutboundProxy({
        kind: "url",
        url: "http://127.0.0.1:7890",
      }),
    ).toBe("function");
  });
});
