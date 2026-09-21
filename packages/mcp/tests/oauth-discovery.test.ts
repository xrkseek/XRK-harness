import { describe, expect, it } from "vitest";
import {
  McpOAuthDiscoveryError,
  authorizationServerMetadataUrls,
  discoverAuthorizationServerMetadata,
  discoverDeviceCodeEndpoints,
  discoverProtectedResource,
  parseAuthorizationServerMetadata,
  parseProtectedResourceMetadata,
  parseResourceMetadataChallenge,
  protectedResourceMetadataUrls,
} from "../src/oauth-discovery.js";

/** Minimal `fetch` fake: exact-URL → scripted response. */
function fakeFetch(
  routes: Readonly<
    Record<
      string,
      | { status?: number; body: unknown; headers?: Record<string, string> }
      | "network-error"
    >
  >,
): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    const route = routes[url];
    if (route === undefined || route === "network-error") {
      throw new Error(`network error: ${url}`);
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json", ...route.headers },
    });
  }) as typeof fetch;
  return { fetch: impl, calls };
}

describe("well-known URL construction", () => {
  it("keeps the resource path as a suffix, most specific first", () => {
    expect(protectedResourceMetadataUrls("https://mcp.example.com/mcp")).toEqual([
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
      "https://mcp.example.com/.well-known/oauth-protected-resource",
    ]);
    // A bare origin has no path suffix to try.
    expect(protectedResourceMetadataUrls("https://mcp.example.com")).toEqual([
      "https://mcp.example.com/.well-known/oauth-protected-resource",
    ]);
  });

  it("tries RFC 8414 and both OIDC placements for an issuer with a path", () => {
    const urls = authorizationServerMetadataUrls("https://idp.example.com/tenant1");
    expect(urls[0]).toBe(
      "https://idp.example.com/.well-known/oauth-authorization-server/tenant1",
    );
    expect(urls).toContain(
      "https://idp.example.com/.well-known/openid-configuration/tenant1",
    );
    expect(urls).toContain(
      "https://idp.example.com/tenant1/.well-known/openid-configuration",
    );
  });

  it("rejects a non-absolute URL with a typed error", () => {
    expect(() => protectedResourceMetadataUrls("not a url")).toThrow(
      McpOAuthDiscoveryError,
    );
  });
});

describe("document parsing", () => {
  it("narrows protected resource metadata and drops non-string entries", () => {
    expect(
      parseProtectedResourceMetadata({
        resource: " https://mcp.example.com ",
        authorization_servers: ["https://idp.example.com", 7, ""],
        scopes_supported: ["mcp:read", null],
      }),
    ).toEqual({
      resource: "https://mcp.example.com",
      authorizationServers: ["https://idp.example.com"],
      scopesSupported: ["mcp:read"],
    });
  });

  it("reads the device flow endpoints from authorization server metadata", () => {
    expect(
      parseAuthorizationServerMetadata({
        issuer: "https://idp.example.com",
        token_endpoint: "https://idp.example.com/oauth/token",
        device_authorization_endpoint: "https://idp.example.com/oauth/device",
        registration_endpoint: "https://idp.example.com/oauth/register",
      }),
    ).toEqual({
      issuer: "https://idp.example.com",
      deviceAuthorizationUrl: "https://idp.example.com/oauth/device",
      tokenUrl: "https://idp.example.com/oauth/token",
      registrationUrl: "https://idp.example.com/oauth/register",
      scopesSupported: [],
    });
  });

  it("fails closed when the token endpoint or device flow is missing", () => {
    expect(() => parseAuthorizationServerMetadata([])).toThrow(/not a JSON object/);
    expect(() => parseAuthorizationServerMetadata({ token_endpoint: "" })).toThrow(
      /no token_endpoint/,
    );
    try {
      parseAuthorizationServerMetadata({
        token_endpoint: "https://idp.example.com/token",
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(McpOAuthDiscoveryError);
      expect((err as McpOAuthDiscoveryError).code).toBe("unsupported");
    }
  });

  it("pulls resource_metadata out of a WWW-Authenticate challenge", () => {
    expect(
      parseResourceMetadataChallenge(
        'Bearer realm="mcp", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
      ),
    ).toBe("https://mcp.example.com/.well-known/oauth-protected-resource");
    expect(parseResourceMetadataChallenge('Bearer realm="mcp"')).toBeUndefined();
    expect(parseResourceMetadataChallenge(null)).toBeUndefined();
  });
});

describe("discoverProtectedResource", () => {
  it("prefers the path-suffixed document", async () => {
    const { fetch, calls } = fakeFetch({
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp": {
        body: {
          resource: "https://mcp.example.com/mcp",
          authorization_servers: ["https://idp.example.com"],
        },
      },
    });
    const meta = await discoverProtectedResource("https://mcp.example.com/mcp", {
      fetch,
    });
    expect(meta.authorizationServers).toEqual(["https://idp.example.com"]);
    expect(meta.metadataUrl).toBe(
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
    );
    expect(calls).toHaveLength(1);
  });

  it("falls back to the bare origin document", async () => {
    const { fetch } = fakeFetch({
      "https://mcp.example.com/.well-known/oauth-protected-resource": {
        status: 200,
        body: { authorization_servers: ["https://idp.example.com"] },
      },
    });
    const meta = await discoverProtectedResource("https://mcp.example.com/mcp", {
      fetch,
    });
    expect(meta.metadataUrl).toBe(
      "https://mcp.example.com/.well-known/oauth-protected-resource",
    );
  });

  it("follows the 401 WWW-Authenticate hint when no well-known document exists", async () => {
    const hinted = "https://mcp.example.com/prm.json";
    const impl = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === hinted) {
        return new Response(
          JSON.stringify({ authorization_servers: ["https://idp.example.com"] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response("no", {
        status: 401,
        headers: { "www-authenticate": `Bearer resource_metadata="${hinted}"` },
      });
    }) as typeof fetch;

    const meta = await discoverProtectedResource("https://mcp.example.com/mcp", {
      fetch: impl,
    });
    expect(meta.metadataUrl).toBe(hinted);
    expect(meta.authorizationServers).toEqual(["https://idp.example.com"]);
  });

  it("reports every candidate it tried when nothing works", async () => {
    const { fetch } = fakeFetch({});
    await expect(
      discoverProtectedResource("https://mcp.example.com/mcp", { fetch }),
    ).rejects.toMatchObject({ code: "request-failed" });
    try {
      await discoverProtectedResource("https://mcp.example.com/mcp", { fetch });
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain(
        "https://mcp.example.com/.well-known/oauth-protected-resource/mcp → unreachable",
      );
      expect(message).toContain(
        "https://mcp.example.com/.well-known/oauth-protected-resource → unreachable",
      );
    }
  });
});

describe("discoverAuthorizationServerMetadata", () => {
  it("skips a document without a device flow and keeps looking", async () => {
    const { fetch } = fakeFetch({
      "https://idp.example.com/.well-known/oauth-authorization-server": {
        body: { token_endpoint: "https://idp.example.com/token" },
      },
      "https://idp.example.com/.well-known/openid-configuration": {
        body: {
          token_endpoint: "https://idp.example.com/token",
          device_authorization_endpoint: "https://idp.example.com/device",
        },
      },
    });
    const meta = await discoverAuthorizationServerMetadata("https://idp.example.com", {
      fetch,
    });
    expect(meta.deviceAuthorizationUrl).toBe("https://idp.example.com/device");
    expect(meta.metadataUrl).toBe(
      "https://idp.example.com/.well-known/openid-configuration",
    );
  });
});

describe("discoverDeviceCodeEndpoints", () => {
  const protectedResourceUrl =
    "https://mcp.example.com/.well-known/oauth-protected-resource";
  const issuerUrl = "https://idp.example.com/.well-known/oauth-authorization-server";

  it("resolves endpoints and binds the advertised resource as the audience", async () => {
    const { fetch } = fakeFetch({
      [protectedResourceUrl]: {
        body: {
          resource: "https://mcp.example.com/mcp",
          authorization_servers: ["https://idp.example.com"],
          scopes_supported: ["mcp:read", "mcp:write"],
        },
      },
      [issuerUrl]: {
        body: {
          token_endpoint: "https://idp.example.com/oauth/token",
          device_authorization_endpoint: "https://idp.example.com/oauth/device",
        },
      },
    });

    const result = await discoverDeviceCodeEndpoints({
      resourceUrl: "https://mcp.example.com/mcp",
      clientId: "client-1",
      deps: { fetch },
    });

    expect(result.endpoints).toEqual({
      deviceAuthorizationUrl: "https://idp.example.com/oauth/device",
      tokenUrl: "https://idp.example.com/oauth/token",
      clientId: "client-1",
      scopes: ["mcp:read", "mcp:write"],
      audience: "https://mcp.example.com/mcp",
    });
    expect(result.protectedResource.scopesSupported).toEqual(["mcp:read", "mcp:write"]);
  });

  it("lets the caller override scopes and audience", async () => {
    const { fetch } = fakeFetch({
      [protectedResourceUrl]: {
        body: {
          resource: "https://mcp.example.com/mcp",
          authorization_servers: ["https://idp.example.com"],
          scopes_supported: ["discovered"],
        },
      },
      [issuerUrl]: {
        body: {
          token_endpoint: "https://idp.example.com/token",
          device_authorization_endpoint: "https://idp.example.com/device",
        },
      },
    });
    const result = await discoverDeviceCodeEndpoints({
      resourceUrl: "https://mcp.example.com/mcp",
      clientId: "c",
      scopes: ["explicit"],
      audience: "https://other.example.com",
      deps: { fetch },
    });
    expect(result.endpoints.scopes).toEqual(["explicit"]);
    expect(result.endpoints.audience).toBe("https://other.example.com");
  });

  it("omits scope and audience when nothing advertises them", async () => {
    const { fetch } = fakeFetch({
      [protectedResourceUrl]: {
        body: { authorization_servers: ["https://idp.example.com"] },
      },
      [issuerUrl]: {
        body: {
          token_endpoint: "https://idp.example.com/token",
          device_authorization_endpoint: "https://idp.example.com/device",
        },
      },
    });
    const result = await discoverDeviceCodeEndpoints({
      resourceUrl: "https://mcp.example.com/mcp",
      clientId: "c",
      deps: { fetch },
    });
    expect(result.endpoints).not.toHaveProperty("scopes");
    expect(result.endpoints).not.toHaveProperty("audience");
  });

  it("fails closed when no authorization server is advertised", async () => {
    const { fetch } = fakeFetch({
      [protectedResourceUrl]: { body: { resource: "https://mcp.example.com" } },
    });
    await expect(
      discoverDeviceCodeEndpoints({
        resourceUrl: "https://mcp.example.com/mcp",
        clientId: "c",
        deps: { fetch },
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
  });
});
