import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  McpDeviceCodeError,
  McpDeviceTokenStore,
  deviceAuthorizationHeaders,
  isTokenExpired,
  loginWithDeviceCode,
  mergeAuthHeaders,
  parseDeviceCodeResponse,
  parseTokenResponse,
  pollDeviceToken,
  refreshDeviceToken,
  startDeviceAuthorization,
  type McpDeviceCodeEndpoints,
} from "../src/oauth-device.js";
import type { McpHttpAuthProvider } from "../src/types.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const ENDPOINTS: McpDeviceCodeEndpoints = {
  deviceAuthorizationUrl: "https://idp.test/device",
  tokenUrl: "https://idp.test/token",
  clientId: "client-1",
  scopes: ["mcp.read", "mcp.write"],
  audience: "https://mcp.test/api",
};

function jsonResponse(body: unknown, status = 200): Response {
  return { status, json: async () => body } as unknown as Response;
}

interface Call {
  readonly url: string;
  readonly body: string;
}

function scriptedFetch(responses: readonly Response[]): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const queue = [...responses];
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: typeof init?.body === "string" ? init.body : "",
    });
    const next = queue.shift();
    if (!next) throw new Error("no scripted response");
    return next;
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function fakeClock(startMs = 1_000_000): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  advance: (ms: number) => void;
} {
  let current = startMs;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
    advance: (ms: number) => {
      current += ms;
    },
  };
}

const START_BODY = {
  device_code: "dc-1",
  user_code: "WDJB-MJHT",
  verification_uri: "https://idp.test/activate",
  verification_uri_complete: "https://idp.test/activate?code=WDJB-MJHT",
  expires_in: 600,
  interval: 1,
};

describe("parseDeviceCodeResponse", () => {
  it("validates required fields and applies defaults", () => {
    const start = parseDeviceCodeResponse(START_BODY);
    expect(start.deviceCode).toBe("dc-1");
    expect(start.userCode).toBe("WDJB-MJHT");
    expect(start.verificationUri).toBe("https://idp.test/activate");
    expect(start.verificationUriComplete).toContain("code=WDJB-MJHT");
    expect(start.expiresIn).toBe(600);
    expect(start.interval).toBe(1);

    // Interval / expiry default when the server omits them.
    const minimal = parseDeviceCodeResponse({
      device_code: "dc",
      user_code: "uc",
      verification_uri: "https://idp.test/activate",
    });
    expect(minimal.interval).toBe(5);
    expect(minimal.expiresIn).toBe(600);
    expect(minimal.verificationUriComplete).toBeUndefined();
  });

  it("rejects a malformed body with a typed error", () => {
    for (const bad of [null, {}, { device_code: "x" }, "nope"]) {
      try {
        parseDeviceCodeResponse(bad);
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(McpDeviceCodeError);
        expect((err as McpDeviceCodeError).code).toBe("invalid-response");
      }
    }
  });
});

describe("parseTokenResponse", () => {
  it("derives expiresAt from the injected clock", () => {
    const tokens = parseTokenResponse(
      { access_token: "at", token_type: "Bearer", expires_in: 3600 },
      () => 5000,
    );
    expect(tokens.accessToken).toBe("at");
    expect(tokens.expiresAt).toBe(5000 + 3_600_000);
  });

  it("omits expiresAt when the server sends no expiry", () => {
    const tokens = parseTokenResponse({ access_token: "at" }, () => 0);
    expect(tokens.expiresAt).toBeUndefined();
    expect(tokens.tokenType).toBe("Bearer");
  });

  it("rejects a token response without access_token", () => {
    expect(() => parseTokenResponse({ token_type: "Bearer" }, () => 0)).toThrow(
      McpDeviceCodeError,
    );
  });
});

describe("startDeviceAuthorization", () => {
  it("posts client_id, scopes and audience as a form body", async () => {
    const { fetch, calls } = scriptedFetch([jsonResponse(START_BODY)]);
    const start = await startDeviceAuthorization(ENDPOINTS, { fetch });
    expect(start.userCode).toBe("WDJB-MJHT");
    expect(calls[0]?.url).toBe("https://idp.test/device");
    const params = new URLSearchParams(calls[0]?.body ?? "");
    expect(params.get("client_id")).toBe("client-1");
    expect(params.get("scope")).toBe("mcp.read mcp.write");
    expect(params.get("resource")).toBe("https://mcp.test/api");
  });

  it("surfaces the server error code on failure", async () => {
    const { fetch } = scriptedFetch([jsonResponse({ error: "invalid_client" }, 401)]);
    await expect(startDeviceAuthorization(ENDPOINTS, { fetch })).rejects.toMatchObject({
      code: "device-authorization-failed",
      oauthError: "invalid_client",
    });
  });
});

describe("pollDeviceToken", () => {
  it("polls through authorization_pending to a token", async () => {
    const clock = fakeClock();
    const { fetch, calls } = scriptedFetch([
      jsonResponse({ error: "authorization_pending" }, 400),
      jsonResponse({ error: "authorization_pending" }, 400),
      jsonResponse({ access_token: "at-1", token_type: "Bearer", expires_in: 3600 }),
    ]);
    const pending: number[] = [];
    const tokens = await pollDeviceToken(
      ENDPOINTS,
      parseDeviceCodeResponse(START_BODY),
      {
        fetch,
        now: clock.now,
        sleep: clock.sleep,
        onPending: (attempt) => pending.push(attempt),
      },
    );
    expect(tokens.accessToken).toBe("at-1");
    expect(tokens.expiresAt).toBe(clock.now() + 3_600_000);
    expect(pending).toEqual([1, 2]);
    expect(calls).toHaveLength(3);
    expect(new URLSearchParams(calls[0]?.body ?? "").get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:device_code",
    );
  });

  it("widens the interval on slow_down", async () => {
    const clock = fakeClock();
    const { fetch } = scriptedFetch([
      jsonResponse({ error: "slow_down" }, 400),
      jsonResponse({ access_token: "at-2", token_type: "Bearer" }),
    ]);
    const intervals: number[] = [];
    await pollDeviceToken(ENDPOINTS, parseDeviceCodeResponse(START_BODY), {
      fetch,
      now: clock.now,
      sleep: clock.sleep,
      onPending: (_attempt, intervalMs) => intervals.push(intervalMs),
    });
    // start interval 1s → slow_down adds 5s.
    expect(intervals).toEqual([6000]);
  });

  it("fails fast on access_denied", async () => {
    const clock = fakeClock();
    const { fetch } = scriptedFetch([jsonResponse({ error: "access_denied" }, 400)]);
    await expect(
      pollDeviceToken(ENDPOINTS, parseDeviceCodeResponse(START_BODY), {
        fetch,
        now: clock.now,
        sleep: clock.sleep,
      }),
    ).rejects.toMatchObject({ code: "access-denied", oauthError: "access_denied" });
  });

  it("expires when the device code deadline passes while pending", async () => {
    const clock = fakeClock();
    const { fetch } = scriptedFetch([
      jsonResponse({ error: "authorization_pending" }, 400),
    ]);
    await expect(
      pollDeviceToken(
        ENDPOINTS,
        parseDeviceCodeResponse({ ...START_BODY, expires_in: 1, interval: 1 }),
        { fetch, now: clock.now, sleep: clock.sleep },
      ),
    ).rejects.toMatchObject({ code: "expired-token" });
  });

  it("reports expired_token from the server", async () => {
    const clock = fakeClock();
    const { fetch } = scriptedFetch([jsonResponse({ error: "expired_token" }, 400)]);
    await expect(
      pollDeviceToken(ENDPOINTS, parseDeviceCodeResponse(START_BODY), {
        fetch,
        now: clock.now,
        sleep: clock.sleep,
      }),
    ).rejects.toMatchObject({ code: "expired-token" });
  });

  it("honors an aborted signal", async () => {
    const clock = fakeClock();
    const { fetch } = scriptedFetch([jsonResponse({ access_token: "at" })]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      pollDeviceToken(ENDPOINTS, parseDeviceCodeResponse(START_BODY), {
        fetch,
        now: clock.now,
        sleep: clock.sleep,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "aborted" });
  });
});

describe("loginWithDeviceCode", () => {
  it("announces the user code then returns the tokens", async () => {
    const clock = fakeClock();
    const { fetch } = scriptedFetch([
      jsonResponse(START_BODY),
      jsonResponse({ access_token: "at-3", token_type: "Bearer", expires_in: 60 }),
    ]);
    const prompts: string[] = [];
    const result = await loginWithDeviceCode(ENDPOINTS, {
      fetch,
      now: clock.now,
      sleep: clock.sleep,
      onPrompt: (start) => prompts.push(start.userCode),
    });
    expect(prompts).toEqual(["WDJB-MJHT"]);
    expect(result.tokens.accessToken).toBe("at-3");
    expect(result.start.verificationUriComplete).toContain("WDJB-MJHT");
  });
});

describe("refreshDeviceToken", () => {
  it("keeps the previous refresh token when the response omits one", async () => {
    const { fetch, calls } = scriptedFetch([
      jsonResponse({ access_token: "at-new", token_type: "Bearer", expires_in: 60 }),
    ]);
    const tokens = await refreshDeviceToken(ENDPOINTS, "rt-old", {
      fetch,
      now: () => 0,
    });
    expect(tokens.accessToken).toBe("at-new");
    expect(tokens.refreshToken).toBe("rt-old");
    expect(new URLSearchParams(calls[0]?.body ?? "").get("grant_type")).toBe(
      "refresh_token",
    );
  });

  it("prefers a rotated refresh token", async () => {
    const { fetch } = scriptedFetch([
      jsonResponse({ access_token: "at", refresh_token: "rt-new" }),
    ]);
    const tokens = await refreshDeviceToken(ENDPOINTS, "rt-old", { fetch });
    expect(tokens.refreshToken).toBe("rt-new");
  });

  it("throws a typed error on refresh failure", async () => {
    const { fetch } = scriptedFetch([jsonResponse({ error: "invalid_grant" }, 400)]);
    await expect(
      refreshDeviceToken(ENDPOINTS, "rt-old", { fetch }),
    ).rejects.toMatchObject({ code: "refresh-failed", oauthError: "invalid_grant" });
  });
});

describe("isTokenExpired / deviceAuthorizationHeaders", () => {
  it("treats a missing token as expired and applies the skew window", () => {
    expect(isTokenExpired(undefined)).toBe(true);
    const tokens = { accessToken: "at", tokenType: "Bearer", expiresAt: 100_000 };
    expect(isTokenExpired(tokens, () => 60_000, 30_000)).toBe(false);
    expect(isTokenExpired(tokens, () => 80_000, 30_000)).toBe(true);
    // No expiry recorded → considered live.
    expect(isTokenExpired({ accessToken: "at", tokenType: "Bearer" })).toBe(false);
  });

  it("builds the authorization header from the token type", () => {
    expect(
      deviceAuthorizationHeaders({ accessToken: "at", tokenType: "Bearer" }),
    ).toEqual({ authorization: "Bearer at" });
    expect(
      deviceAuthorizationHeaders({ accessToken: "at", tokenType: "DPoP" }),
    ).toEqual({ authorization: "DPoP at" });
    expect(deviceAuthorizationHeaders({ accessToken: "at", tokenType: "" })).toEqual({
      authorization: "Bearer at",
    });
  });
});

describe("McpDeviceTokenStore", () => {
  it("persists, reloads and clears tokens", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-mcp-token-"));
    temps.push(dir);
    const file = path.join(dir, "mcp-oauth.json");
    const store = new McpDeviceTokenStore(file);
    expect(store.get()).toBeUndefined();
    store.set({ accessToken: "at", tokenType: "Bearer", refreshToken: "rt" });

    const cold = new McpDeviceTokenStore(file);
    expect(cold.get()?.accessToken).toBe("at");
    expect(cold.get()?.refreshToken).toBe("rt");

    cold.clear();
    expect(new McpDeviceTokenStore(file).get()).toBeUndefined();
  });

  it("returns no headers when logged out", async () => {
    const store = new McpDeviceTokenStore();
    expect(await store.headers()).toEqual({});
  });

  it("returns the live token header without refreshing", async () => {
    const store = new McpDeviceTokenStore();
    store.set({
      accessToken: "at-live",
      tokenType: "Bearer",
      expiresAt: 10_000_000,
    });
    const { fetch, calls } = scriptedFetch([]);
    const headers = await store.headers(ENDPOINTS, { fetch, now: () => 1_000_000 });
    expect(headers).toEqual({ authorization: "Bearer at-live" });
    expect(calls).toHaveLength(0);
  });

  it("refreshes and persists an expired token", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-mcp-token-"));
    temps.push(dir);
    const file = path.join(dir, "mcp-oauth.json");
    const store = new McpDeviceTokenStore(file);
    store.set({
      accessToken: "at-old",
      tokenType: "Bearer",
      refreshToken: "rt-old",
      expiresAt: 1_000,
    });
    const { fetch } = scriptedFetch([
      jsonResponse({ access_token: "at-fresh", expires_in: 3600 }),
    ]);
    const headers = await store.headers(ENDPOINTS, { fetch, now: () => 2_000 });
    expect(headers).toEqual({ authorization: "Bearer at-fresh" });
    expect(store.get()?.accessToken).toBe("at-fresh");
    expect(new McpDeviceTokenStore(file).get()?.accessToken).toBe("at-fresh");
  });

  it("keeps the stale header when no refresh token is available", async () => {
    const store = new McpDeviceTokenStore();
    store.set({ accessToken: "at-old", tokenType: "Bearer", expiresAt: 1_000 });
    const { fetch, calls } = scriptedFetch([]);
    const headers = await store.headers(ENDPOINTS, { fetch, now: () => 2_000 });
    expect(headers).toEqual({ authorization: "Bearer at-old" });
    expect(calls).toHaveLength(0);
  });
});

describe("mergeAuthHeaders", () => {
  it("returns the original requestInit when there is nothing to add", () => {
    expect(mergeAuthHeaders(undefined, undefined)).toBeUndefined();
    expect(mergeAuthHeaders(undefined, {})).toBeUndefined();
    const init: RequestInit = { method: "POST" };
    expect(mergeAuthHeaders(init, {})).toBe(init);
  });

  it("adds auth headers to a requestInit that had none", () => {
    const merged = mergeAuthHeaders(undefined, { authorization: "Bearer at" });
    expect(merged?.headers).toBeInstanceOf(Headers);
    expect(new Headers(merged?.headers).get("authorization")).toBe("Bearer at");
  });

  it("preserves caller headers and lets auth win on collision", () => {
    const merged = mergeAuthHeaders(
      {
        method: "POST",
        headers: { "x-trace": "abc", authorization: "Bearer stale" },
      },
      { authorization: "Bearer fresh" },
    );
    const headers = new Headers(merged?.headers);
    expect(merged?.method).toBe("POST");
    expect(headers.get("x-trace")).toBe("abc");
    expect(headers.get("authorization")).toBe("Bearer fresh");
  });

  it("accepts a Headers instance as the caller's requestInit headers", () => {
    const merged = mergeAuthHeaders(
      { headers: new Headers({ "x-keep": "1" }) },
      { authorization: "Bearer at" },
    );
    const headers = new Headers(merged?.headers);
    expect(headers.get("x-keep")).toBe("1");
    expect(headers.get("authorization")).toBe("Bearer at");
  });
});

describe("transport wiring", () => {
  it("a token store satisfies the auth provider and yields a transport header", async () => {
    // `McpHttpOptions.auth` is awaited then merged onto `requestInit`; this
    // asserts the store side of that contract without opening a socket.
    const store: McpHttpAuthProvider = new McpDeviceTokenStore();
    await store.headers();
    const live = new McpDeviceTokenStore();
    live.set({ accessToken: "at-live", tokenType: "Bearer", expiresAt: 9_999_999 });
    const requestInit = mergeAuthHeaders(undefined, await store.headers());
    const withAuth = mergeAuthHeaders(requestInit, await live.headers());
    expect(new Headers(withAuth?.headers).get("authorization")).toBe("Bearer at-live");
  });
});
