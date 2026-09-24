import { afterEach, describe, expect, it } from "vitest";
import {
  clearOutboundAllowlistAuditLog,
  createOutboundAllowlist,
  getOutboundAllowlistAuditLog,
  parseOutboundAllowlistHosts,
} from "../src/outbound-allowlist.js";
import { assertHttpUrl } from "../src/url-policy.js";
import { WebError } from "../src/types.js";

describe("outbound allowlist", () => {
  afterEach(() => {
    clearOutboundAllowlistAuditLog();
  });

  it("parses env host lists", () => {
    expect(parseOutboundAllowlistHosts("Example.COM, *.foo.org")).toEqual([
      "example.com",
      "*.foo.org",
    ]);
  });

  it("open mode allows public hosts and audits private denials", () => {
    const allow = createOutboundAllowlist({ hosts: [] });
    expect(allow.mode).toBe("open");
    expect(() =>
      assertHttpUrl("https://example.com/a", 2048, { allowlist: allow }),
    ).not.toThrow();
    expect(getOutboundAllowlistAuditLog()).toHaveLength(0);

    expect(() =>
      assertHttpUrl("http://127.0.0.1/", 2048, { allowlist: allow }),
    ).toThrow(WebError);
    const log = getOutboundAllowlistAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.decision).toBe("deny");
    expect(log[0]?.source).toBe("private_host");
  });

  it("allowlist mode denies unknown hosts and audits", () => {
    const allow = createOutboundAllowlist({
      hosts: ["example.com", "*.trusted.dev"],
    });
    assertHttpUrl("https://example.com/", 2048, { allowlist: allow });
    assertHttpUrl("https://api.trusted.dev/", 2048, { allowlist: allow });
    expect(() =>
      assertHttpUrl("https://evil.test/", 2048, { allowlist: allow }),
    ).toThrow(/allowlist/i);

    const log = getOutboundAllowlistAuditLog();
    expect(log.some((e) => e.decision === "allow" && e.host === "example.com")).toBe(
      true,
    );
    expect(log.some((e) => e.decision === "deny" && e.host === "evil.test")).toBe(
      true,
    );
  });
});
