import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  defaultTokenDir,
  mcpHelpText,
  resolveTokenFile,
  runMcp,
  type McpCommandDeps,
} from "../src/commands/mcp.js";
import { main } from "../src/index.js";

const temps: string[] = [];
let outSpy: MockInstance;
let errSpy: MockInstance;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function written(spy: MockInstance): string {
  return spy.mock.calls.map((c) => String(c[0])).join("");
}

const stdout = (): string => written(outSpy);
const stderr = (): string => written(errSpy);

function clear(): void {
  outSpy.mockClear();
  errSpy.mockClear();
}

beforeEach(() => {
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
});

afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

/** Scripted fetch: device authorization + token endpoints, recording bodies. */
function flowFetch(options?: {
  readonly token?: readonly unknown[];
  /** Status + body per call index for the token endpoint (default: one 200). */
  readonly device?: unknown;
}): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...(options?.token ?? [])];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    });
    if (url.includes("device")) {
      return new Response(
        JSON.stringify(
          options?.device ?? {
            device_code: "dev-1",
            user_code: "ABCD-1234",
            verification_uri: "https://idp.example.com/activate",
            verification_uri_complete:
              "https://idp.example.com/activate?code=ABCD-1234",
            expires_in: 600,
            interval: 1,
          },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    const next = queue.length > 0 ? queue.shift() : undefined;
    const payload = next ?? {
      access_token: "tok-1",
      token_type: "Bearer",
      expires_in: 3600,
    };
    if (payload && typeof payload === "object" && "__status" in payload) {
      const { __status, ...body } = payload as { __status: number } & Record<
        string,
        unknown
      >;
      return new Response(JSON.stringify(body), {
        status: __status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: impl, calls };
}

/**
 * A fake clock whose `sleep` advances time instantly. RFC 8628 requires waiting
 * one `interval` before the first poll, so a flow that polls once still moves
 * the clock — `at()` exposes that so tests can assert real expiry times.
 */
function fakeClock(start = 1_000_000): {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly at: () => number;
} {
  let clock = start;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    at: () => clock,
  };
}

/** Deterministic flow deps: a fake clock and an immediate "sleep". */
function flowDeps(
  homeDir: string,
  fetchImpl: typeof fetch,
  clock = fakeClock(),
): McpCommandDeps {
  return {
    homeDir,
    fetch: fetchImpl,
    now: clock.now,
    sleep: clock.sleep,
  };
}

const DEVICE_URL = "https://idp.example.com/oauth/device";
const TOKEN_URL = "https://idp.example.com/oauth/token";

describe("runMcp help / dispatch", () => {
  it("prints help with no arguments", async () => {
    expect(await runMcp([])).toBe(0);
    expect(stdout()).toContain("xrkh mcp —");
    expect(mcpHelpText()).toContain("XRK_MCP_OAUTH_TOKEN_DIR");
  });

  it("reports an unknown subcommand", async () => {
    expect(await runMcp(["bogus"])).toBe(1);
    expect(stderr()).toContain("unknown mcp subcommand: bogus");
  });

  it("requires a server name for login and logout", async () => {
    expect(await runMcp(["login"])).toBe(1);
    expect(stderr()).toContain("mcp login needs a <server> name");
    clear();
    expect(await runMcp(["logout"])).toBe(1);
    expect(stderr()).toContain("mcp logout needs a <server> name");
  });

  it("rejects unknown flags and missing flag values", async () => {
    expect(await runMcp(["login", "srv", "--nope"])).toBe(1);
    expect(stderr()).toContain("unknown flag: --nope");
    clear();
    expect(await runMcp(["login", "srv", "--url"])).toBe(1);
    expect(stderr()).toContain("--url needs a value");
  });

  it("refuses a server name that would escape the token dir", async () => {
    const home = tempDir("xrk-mcp-home-");
    expect(
      await runMcp(["login", "../../evil", "--client-id", "c"], { homeDir: home }),
    ).toBe(1);
    expect(stderr()).toContain("invalid MCP serverName");
    expect(existsSync(path.join(home, "..", "evil.json"))).toBe(false);
  });
});

describe("runMcp login", () => {
  it("runs the device flow and persists the token with 0600 permissions", async () => {
    const home = tempDir("xrk-mcp-home-");
    const { fetch, calls } = flowFetch();
    const code = await runMcp(
      [
        "login",
        "linear",
        "--client-id",
        "xrk-cli",
        "--device-authorization-url",
        DEVICE_URL,
        "--token-url",
        TOKEN_URL,
        "--scope",
        "mcp:read,mcp:write",
        "--audience",
        "https://mcp.example.com/mcp",
      ],
      flowDeps(home, fetch),
    );

    expect(code).toBe(0);
    expect(stdout()).toContain("ABCD-1234");
    expect(stdout()).toContain("https://idp.example.com/activate?code=ABCD-1234");
    expect(stdout()).toContain("logged in linear");

    const file = path.join(home, "mcp-tokens", "linear.json");
    expect(stdout()).toContain(file);
    const persisted = JSON.parse(readFileSync(file, "utf8")) as {
      tokens: { accessToken: string; scope?: string };
    };
    expect(persisted.tokens.accessToken).toBe("tok-1");

    // Device request carries client_id + scopes + resource; token request uses
    // the device-code grant.
    const device = calls.find((c) => c.url === DEVICE_URL);
    expect(device?.method).toBe("POST");
    expect(device?.body).toContain("client_id=xrk-cli");
    expect(device?.body).toContain("scope=mcp%3Aread+mcp%3Awrite");
    expect(device?.body).toContain("resource=https%3A%2F%2Fmcp.example.com%2Fmcp");
    const token = calls.find((c) => c.url === TOKEN_URL);
    expect(token?.body).toContain(
      "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code",
    );

    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it("retries while the server says authorization_pending", async () => {
    const home = tempDir("xrk-mcp-home-");
    const { fetch, calls } = flowFetch({
      token: [
        { __status: 400, error: "authorization_pending" },
        { access_token: "tok-2", token_type: "Bearer" },
      ],
    });
    const code = await runMcp(
      [
        "login",
        "slow",
        "--client-id",
        "c",
        "--device-authorization-url",
        DEVICE_URL,
        "--token-url",
        TOKEN_URL,
      ],
      flowDeps(home, fetch),
    );

    expect(code).toBe(0);
    expect(stderr()).toContain("waiting for approval (attempt 1");
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(2);
  });

  it("fails closed on access_denied without writing a token", async () => {
    const home = tempDir("xrk-mcp-home-");
    const { fetch } = flowFetch({
      token: [{ __status: 400, error: "access_denied" }],
    });
    const code = await runMcp(
      [
        "login",
        "denied",
        "--client-id",
        "c",
        "--device-authorization-url",
        DEVICE_URL,
        "--token-url",
        TOKEN_URL,
      ],
      flowDeps(home, fetch),
    );

    expect(code).toBe(1);
    expect(stderr()).toContain("access-denied");
    expect(existsSync(path.join(home, "mcp-tokens", "denied.json"))).toBe(false);
  });

  it("discovers endpoints from the server URL and binds the resource audience", async () => {
    const home = tempDir("xrk-mcp-home-");
    const calls: Call[] = [];
    const routes: Record<string, unknown> = {
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp": {
        resource: "https://mcp.example.com/mcp",
        authorization_servers: ["https://idp.example.com"],
        scopes_supported: ["mcp:read"],
      },
      "https://idp.example.com/.well-known/oauth-authorization-server": {
        token_endpoint: TOKEN_URL,
        device_authorization_endpoint: DEVICE_URL,
      },
    };
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : "",
      });
      if (url === DEVICE_URL) {
        return new Response(
          JSON.stringify({
            device_code: "d",
            user_code: "CODE",
            verification_uri: "https://idp.example.com/activate",
            expires_in: 300,
            interval: 1,
          }),
          { status: 200 },
        );
      }
      if (url === TOKEN_URL) {
        return new Response(
          JSON.stringify({ access_token: "tok-discovered", token_type: "Bearer" }),
          { status: 200 },
        );
      }
      const doc = routes[url];
      if (doc === undefined) return new Response("nope", { status: 404 });
      return new Response(JSON.stringify(doc), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const code = await runMcp(
      ["login", "linear", "--url", "https://mcp.example.com/mcp", "--client-id", "c"],
      flowDeps(home, fetch),
    );

    expect(code).toBe(0);
    const device = calls.find((c) => c.url === DEVICE_URL);
    // The discovered `resource` becomes the OAuth `resource` param.
    expect(device?.body).toContain("resource=https%3A%2F%2Fmcp.example.com%2Fmcp");
    // Discovered scopes are used when the caller passes none.
    expect(device?.body).toContain("scope=mcp%3Aread");
    expect(stdout()).toContain("logged in linear");
  });

  it("resolves the server URL from XRK_MCP_SERVERS when --url is absent", async () => {
    const home = tempDir("xrk-mcp-home-");
    const deps: McpCommandDeps = {
      homeDir: home,
      env: {
        XRK_MCP_SERVERS: JSON.stringify([
          { serverName: "linear", url: "https://mcp.example.com/mcp" },
        ]),
        XRK_MCP_OAUTH_CLIENT_ID: "env-client",
        XRK_MCP_OAUTH_DEVICE_AUTHORIZATION_URL: DEVICE_URL,
        XRK_MCP_OAUTH_TOKEN_URL: TOKEN_URL,
      },
    };
    const { fetch } = flowFetch();
    const code = await runMcp(["login", "linear"], {
      ...deps,
      ...flowDeps(home, fetch),
      env: deps.env,
    });

    expect(code).toBe(0);
    expect(stdout()).toContain("logged in linear");
    expect(existsSync(path.join(home, "mcp-tokens", "linear.json"))).toBe(true);
  });

  it("fails with a clear message when no client id is available", async () => {
    const home = tempDir("xrk-mcp-home-");
    const code = await runMcp(
      ["login", "srv", "--url", "https://mcp.example.com/mcp"],
      {
        homeDir: home,
        env: {},
      },
    );
    expect(code).toBe(1);
    expect(stderr()).toContain("XRK_MCP_OAUTH_CLIENT_ID");
  });

  it("requires both endpoints when only one is given", async () => {
    const home = tempDir("xrk-mcp-home-");
    const code = await runMcp(
      ["login", "srv", "--client-id", "c", "--token-url", TOKEN_URL],
      { homeDir: home, env: {} },
    );
    expect(code).toBe(1);
    expect(stderr()).toContain("incomplete OAuth endpoints");
  });

  it("refuses --no-discovery without explicit endpoints", async () => {
    const home = tempDir("xrk-mcp-home-");
    const code = await runMcp(
      [
        "login",
        "srv",
        "--client-id",
        "c",
        "--no-discovery",
        "--url",
        "https://x.example.com",
      ],
      { homeDir: home, env: {} },
    );
    expect(code).toBe(1);
    expect(stderr()).toContain("--no-discovery needs");
  });

  it("explains a missing URL when discovery is needed", async () => {
    const home = tempDir("xrk-mcp-home-");
    const code = await runMcp(["login", "srv", "--client-id", "c"], {
      homeDir: home,
      env: {},
    });
    expect(code).toBe(1);
    expect(stderr()).toContain('no URL for MCP server "srv"');
  });

  it("surfaces a discovery failure with its code", async () => {
    const home = tempDir("xrk-mcp-home-");
    const fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    const code = await runMcp(
      ["login", "srv", "--client-id", "c", "--url", "https://mcp.example.com/mcp"],
      { homeDir: home, env: {}, fetch },
    );
    expect(code).toBe(1);
    expect(stderr()).toContain("[request-failed]");
  });

  it("emits NDJSON progress and a terminal result under --json", async () => {
    const home = tempDir("xrk-mcp-home-");
    const { fetch } = flowFetch();
    const code = await runMcp(
      [
        "login",
        "linear",
        "--client-id",
        "c",
        "--device-authorization-url",
        DEVICE_URL,
        "--token-url",
        TOKEN_URL,
        "--json",
      ],
      flowDeps(home, fetch),
    );

    expect(code).toBe(0);
    const lines = stdout()
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[0]?.status).toBe("pending");
    expect(lines[0]?.userCode).toBe("ABCD-1234");
    expect(lines[1]?.status).toBe("logged-in");
    expect(lines[1]?.hasRefreshToken).toBe(false);
  });
});

describe("runMcp status / logout / path / list", () => {
  it("reports logged-out, then valid, then expired", async () => {
    const home = tempDir("xrk-mcp-home-");
    const { fetch } = flowFetch();
    clear();

    expect(await runMcp(["status", "linear"], { homeDir: home, env: {} })).toBe(0);
    expect(stdout()).toContain("linear\tlogged-out");

    clear();
    await runMcp(
      [
        "login",
        "linear",
        "--client-id",
        "c",
        "--device-authorization-url",
        DEVICE_URL,
        "--token-url",
        TOKEN_URL,
      ],
      flowDeps(home, fetch),
    );

    clear();
    let clock = 1_000_000;
    await runMcp(["status", "linear"], {
      homeDir: home,
      env: {},
      now: () => clock,
    });
    expect(stdout()).toContain("linear\tvalid ~60m");

    clear();
    clock += 3_600_000; // past the 1h token lifetime
    await runMcp(["status", "linear"], { homeDir: home, env: {}, now: () => clock });
    expect(stdout()).toContain("linear\texpired");
  });

  it("reports JSON status with expiry and scope", async () => {
    const home = tempDir("xrk-mcp-home-");
    // A real IdP echoes the granted `scope` in the token response.
    const { fetch } = flowFetch({
      token: [
        {
          access_token: "tok-1",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "mcp:read",
        },
      ],
    });
    const clock = fakeClock();
    await runMcp(
      [
        "login",
        "linear",
        "--client-id",
        "c",
        "--device-authorization-url",
        DEVICE_URL,
        "--token-url",
        TOKEN_URL,
        "--scope",
        "mcp:read",
      ],
      flowDeps(home, fetch, clock),
    );
    // The flow waited one interval (1s) before its first poll.
    const issuedAt = clock.at();
    expect(issuedAt).toBe(1_001_000);

    clear();
    await runMcp(["status", "linear", "--json"], {
      homeDir: home,
      env: {},
      now: () => issuedAt,
    });

    const parsed = JSON.parse(stdout().trim()) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      server: "linear",
      loggedIn: true,
      expired: false,
      scope: "mcp:read",
    });
    expect(parsed.expiresAt).toBe(issuedAt + 3_600_000);
  });

  it("defaults status to the configured server list", async () => {
    const home = tempDir("xrk-mcp-home-");
    const code = await runMcp(["status"], {
      homeDir: home,
      env: {
        XRK_MCP_SERVERS: JSON.stringify({
          mcpServers: { linear: { url: "https://mcp.example.com/mcp" } },
        }),
      },
    });
    expect(code).toBe(0);
    expect(stdout()).toContain("linear\tlogged-out");
  });

  it("refuses status with neither a name nor a configured list", async () => {
    const home = tempDir("xrk-mcp-home-");
    expect(await runMcp(["status"], { homeDir: home, env: {} })).toBe(1);
    expect(stderr()).toContain("mcp status needs a <server> name");
  });

  it("logs out, and reports a second attempt as absent", async () => {
    const home = tempDir("xrk-mcp-home-");
    const { fetch } = flowFetch();
    await runMcp(
      [
        "login",
        "linear",
        "--client-id",
        "c",
        "--device-authorization-url",
        DEVICE_URL,
        "--token-url",
        TOKEN_URL,
      ],
      flowDeps(home, fetch),
    );

    clear();
    expect(await runMcp(["logout", "linear"], { homeDir: home, env: {} })).toBe(0);
    expect(stdout()).toContain("logged out linear");
    expect(existsSync(path.join(home, "mcp-tokens", "linear.json"))).toBe(false);

    clear();
    expect(await runMcp(["logout", "linear"], { homeDir: home, env: {} })).toBe(0);
    expect(stdout()).toContain("no token for linear");
  });

  it("prints the token dir and honors --token-dir / env overrides", async () => {
    const home = tempDir("xrk-mcp-home-");
    const dir = tempDir("xrk-mcp-tokens-");

    expect(await runMcp(["path"], { homeDir: home, env: {} })).toBe(0);
    expect(stdout().trim()).toBe(path.resolve(home, "mcp-tokens"));

    clear();
    await runMcp(["path", "--token-dir", dir], { homeDir: home, env: {} });
    expect(stdout().trim()).toBe(path.resolve(dir));

    clear();
    await runMcp(["path"], {
      homeDir: home,
      env: { XRK_MCP_OAUTH_TOKEN_DIR: dir },
    });
    expect(stdout().trim()).toBe(path.resolve(dir));
  });

  it("lists configured servers and their URLs", async () => {
    const home = tempDir("xrk-mcp-home-");
    const code = await runMcp(["list"], {
      homeDir: home,
      env: {
        XRK_MCP_SERVERS: JSON.stringify([
          { serverName: "linear", url: "https://mcp.example.com/mcp" },
          { serverName: "fs", command: "npx" },
        ]),
      },
    });
    expect(code).toBe(0);
    expect(stdout()).toContain("linear\thttps://mcp.example.com/mcp");
    expect(stdout()).toContain("fs\t(stdio)");
  });
});

describe("mcp CLI dispatch", () => {
  it("routes `xrkh mcp …` through main() to the mcp command", async () => {
    const dir = tempDir("xrk-mcp-dispatch-");
    // Pure subcommand: no network, no token writes.
    expect(await main(["mcp", "path", "--token-dir", dir])).toBe(0);
    expect(stdout().trim()).toBe(path.resolve(dir));
  });

  it("routes an unknown mcp subcommand to the command's own error path", async () => {
    expect(await main(["mcp", "bogus"])).toBe(1);
    expect(stderr()).toContain("unknown mcp subcommand: bogus");
  });
});

describe("resolveTokenFile / defaultTokenDir", () => {
  it("resolves under the product home and honors an override", () => {
    const home = tempDir("xrk-mcp-home-");
    expect(defaultTokenDir({ homeDir: home, env: {} })).toBe(
      path.resolve(home, "mcp-tokens"),
    );
    expect(resolveTokenFile("srv", { homeDir: home, env: {} })).toBe(
      path.resolve(home, "mcp-tokens", "srv.json"),
    );
    expect(resolveTokenFile("srv", { tokenDir: "/tmp/tokens" })).toBe(
      path.resolve("/tmp/tokens", "srv.json"),
    );
  });

  it("reads XRK_HOME when no explicit home is injected", () => {
    const home = tempDir("xrk-mcp-home-");
    expect(defaultTokenDir({ env: { XRK_HOME: home } })).toBe(
      path.resolve(home, "mcp-tokens"),
    );
  });
});
