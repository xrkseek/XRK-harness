import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { resetMcpOauthLoginsForTests } from "../src/mcp-oauth.js";
import type { FaceDrain } from "../src/context.js";

function drain(): FaceDrain {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
  };
}

function runtime(productDir: string) {
  const store = createMemorySessionStore();
  return createFaceRuntime({
    store,
    workspaceRoot: productDir,
    productDir,
    drain: drain(),
    resolveAgent: async () => {
      throw new Error("unused");
    },
  });
}

afterEach(() => {
  resetMcpOauthLoginsForTests();
  delete process.env.XRK_MCP_OAUTH_TOKEN_DIR;
});

describe("Face mcp.oauth", () => {
  it("status reports logged-out when no token file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-mcp-oauth-"));
    const rt = runtime(dir);
    const res = await dispatchFaceMethod(rt, "mcp.oauth.status", "s0", {
      servers: ["linear"],
    });
    expect(res.result.ok).toBe(true);
    if (!res.result.ok) return;
    const value = res.result.value as {
      tokenDir: string;
      items: { server: string; loggedIn: boolean; loginPhase: string }[];
    };
    expect(value.tokenDir).toBe(path.join(dir, "mcp-tokens"));
    expect(value.items).toEqual([
      expect.objectContaining({
        server: "linear",
        loggedIn: false,
        loginPhase: "idle",
      }),
    ]);
  });

  it("status + logout round-trip over a persisted token file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-mcp-oauth-"));
    const tokenDir = path.join(dir, "mcp-tokens");
    await mkdir(tokenDir, { recursive: true });
    await writeFile(
      path.join(tokenDir, "linear.json"),
      JSON.stringify({
        tokens: {
          accessToken: "tok",
          tokenType: "Bearer",
          expiresAt: Date.now() + 60_000,
          refreshToken: "ref",
          scope: "mcp",
        },
      }),
      "utf8",
    );
    const rt = runtime(dir);
    const before = await dispatchFaceMethod(rt, "mcp.oauth.status", "s1", {
      servers: ["linear"],
    });
    expect(before.result.ok).toBe(true);
    if (!before.result.ok) return;
    const beforeVal = before.result.value as {
      items: { loggedIn: boolean; loginPhase: string; hasRefreshToken?: boolean }[];
    };
    expect(beforeVal.items[0]).toMatchObject({
      loggedIn: true,
      loginPhase: "logged-in",
      hasRefreshToken: true,
    });

    const loggedOut = await dispatchFaceMethod(rt, "mcp.oauth.logout", "s2", {
      server: "linear",
    });
    expect(loggedOut.result.ok).toBe(true);
    if (!loggedOut.result.ok) return;
    expect(loggedOut.result.value).toEqual({
      server: "linear",
      status: "logged-out",
    });

    const after = await dispatchFaceMethod(rt, "mcp.oauth.status", "s3", {
      servers: ["linear"],
    });
    expect(after.result.ok).toBe(true);
    if (!after.result.ok) return;
    const afterVal = after.result.value as {
      items: { loggedIn: boolean; loginPhase: string }[];
    };
    expect(afterVal.items[0]).toMatchObject({
      loggedIn: false,
      loginPhase: "idle",
    });
  });

  it("login without URL fails closed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-mcp-oauth-"));
    const rt = runtime(dir);
    const res = await dispatchFaceMethod(rt, "mcp.oauth.login", "s4", {
      server: "linear",
    });
    expect(res.result.ok).toBe(false);
    if (res.result.ok) return;
    expect(res.result.error.code).toBe("bad-request");
    expect(res.result.error.message).toMatch(/no URL for MCP server/i);
  });

  it("login maps IdP without device-code to honest error", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-mcp-oauth-"));
    const rt = runtime(dir);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth-protected-resource")) {
        return new Response(
          JSON.stringify({
            resource: "https://mcp.example.com",
            authorization_servers: ["https://idp.example.com"],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes(".well-known")) {
        return new Response(
          JSON.stringify({
            issuer: "https://idp.example.com",
            token_endpoint: "https://idp.example.com/token",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    try {
      const res = await dispatchFaceMethod(rt, "mcp.oauth.login", "s6", {
        server: "linear",
        url: "https://mcp.example.com",
      });
      expect(res.result.ok).toBe(false);
      if (res.result.ok) return;
      expect(res.result.error.code).toBe("bad-request");
      expect(res.result.error.message).toMatch(
        /mcp-oauth-no-device|device-code/i,
      );
      expect(res.result.error.details).toMatchObject({
        reason: "mcp-oauth-no-device",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects invalid server names", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-mcp-oauth-"));
    const rt = runtime(dir);
    const res = await dispatchFaceMethod(rt, "mcp.oauth.logout", "s5", {
      server: "bad name!",
    });
    expect(res.result.ok).toBe(false);
    if (res.result.ok) return;
    expect(res.result.error.code).toBe("bad-request");
  });
});
