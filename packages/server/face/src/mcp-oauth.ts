/**
 * Face `mcp.oauth.*` — device-code login/status/logout for Settings MCP card.
 *
 * Same token layout and discovery path as `xrkh mcp login|status|logout`
 * (`@xrkseek/mcp` oauth-product + discoverDeviceCodeEndpoints). Login returns
 * as soon as the user code is known; Host keeps polling in the background.
 */
import { chmodSync } from "node:fs";
import path from "node:path";
import {
  McpDeviceCodeError,
  McpOAuthDiscoveryError,
  assertServerName,
  discoverDeviceCodeEndpoints,
  loginWithDeviceCode,
  logoutMcpOAuthToken,
  persistMcpOAuthTokens,
  readMcpOAuthTokenStatus,
  type McpDeviceCodeEndpoints,
  type McpDeviceCodeStart,
  type McpOAuthTokenStatus,
} from "@xrkseek/mcp";
import { parseMcpServersValue } from "@xrkseek/server-config";
import type { FaceRuntime } from "./context.js";
import { resolveHarnessHome } from "./settings-document.js";
import type { FaceRpcResult } from "./types.js";
import { asRecord } from "./handlers/types.js";

export type McpOauthLoginPhase =
  | "idle"
  | "pending"
  | "logged-in"
  | "error"
  | "cancelled";

type ActiveLogin = {
  readonly abort: AbortController;
  phase: McpOauthLoginPhase;
  prompt?: McpDeviceCodeStart;
  error?: string;
};

const activeLogins = new Map<string, ActiveLogin>();

/** Test helper — clear in-flight logins between cases. */
export function resetMcpOauthLoginsForTests(): void {
  for (const session of activeLogins.values()) {
    session.abort.abort();
  }
  activeLogins.clear();
}

function tokenDirOf(_runtime: FaceRuntime): string | undefined {
  const raw = process.env.XRK_MCP_OAUTH_TOKEN_DIR?.trim();
  return raw || undefined;
}

function homeOf(runtime: FaceRuntime): string {
  return resolveHarnessHome(runtime);
}

function splitScopes(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function serverUrlFromRuntime(
  runtime: FaceRuntime,
  server: string,
  urlOverride?: string,
): string | undefined {
  if (urlOverride?.trim()) return urlOverride.trim();
  const fromEnvList = process.env.XRK_MCP_SERVERS?.trim();
  if (fromEnvList) {
    try {
      for (const row of parseMcpServersValue(JSON.parse(fromEnvList))) {
        if (row.serverName === server && row.url) return row.url;
      }
    } catch {
      /* fall through to Face namespace */
    }
  }
  try {
    const raw = runtime.settingsNamespaces.ensure("mcp").user.servers;
    for (const row of parseMcpServersValue(raw)) {
      if (row.serverName === server && row.url) return row.url;
    }
  } catch {
    /* ignore parse errors; discovery will fail closed below */
  }
  return process.env.XRK_MCP_OAUTH_URL?.trim() || undefined;
}

async function resolveEndpoints(
  runtime: FaceRuntime,
  server: string,
  options: {
    readonly url?: string;
    readonly clientId?: string;
    readonly deviceAuthorizationUrl?: string;
    readonly tokenUrl?: string;
    readonly scopes?: readonly string[];
    readonly audience?: string;
  },
): Promise<McpDeviceCodeEndpoints> {
  const deviceAuthorizationUrl =
    options.deviceAuthorizationUrl?.trim() ||
    process.env.XRK_MCP_OAUTH_DEVICE_AUTHORIZATION_URL?.trim();
  const tokenUrl =
    options.tokenUrl?.trim() || process.env.XRK_MCP_OAUTH_TOKEN_URL?.trim();
  const clientId =
    options.clientId?.trim() ||
    process.env.XRK_MCP_OAUTH_CLIENT_ID?.trim() ||
    "xrk-web";
  const audience =
    options.audience?.trim() || process.env.XRK_MCP_OAUTH_AUDIENCE?.trim();
  const scopes =
    options.scopes && options.scopes.length > 0
      ? [...options.scopes]
      : splitScopes(process.env.XRK_MCP_OAUTH_SCOPES ?? "");

  if (deviceAuthorizationUrl && tokenUrl) {
    return {
      deviceAuthorizationUrl,
      tokenUrl,
      clientId,
      ...(scopes.length > 0 ? { scopes } : {}),
      ...(audience ? { audience } : {}),
    };
  }
  if (deviceAuthorizationUrl || tokenUrl) {
    throw new Error(
      "incomplete OAuth endpoints: pass both deviceAuthorizationUrl and tokenUrl",
    );
  }

  const resourceUrl = serverUrlFromRuntime(runtime, server, options.url);
  if (!resourceUrl) {
    throw new Error(
      `no URL for MCP server "${server}": configure an HTTP url in Settings → MCP, or pass url`,
    );
  }
  const discovered = await discoverDeviceCodeEndpoints({
    resourceUrl,
    clientId,
    ...(scopes.length > 0 ? { scopes } : {}),
    ...(audience ? { audience } : {}),
  });
  return discovered.endpoints;
}

function isNoDeviceDiscovery(err: McpOAuthDiscoveryError): boolean {
  return (
    (err.code === "unsupported" &&
      /device_authorization_endpoint/i.test(err.message)) ||
    /does not advertise device_authorization_endpoint/i.test(err.message)
  );
}

function oauthErrorMessage(err: unknown): string {
  if (err instanceof McpDeviceCodeError) {
    return `${err.message} [${err.code}${err.oauthError ? `:${err.oauthError}` : ""}]`;
  }
  if (err instanceof McpOAuthDiscoveryError) {
    if (isNoDeviceDiscovery(err)) {
      return (
        "This MCP server's IdP does not advertise device-code login (RFC 8628). " +
        "Hosted MCPs often need browser authorization-code + PKCE (not yet in Settings). " +
        "Override with XRK_MCP_OAUTH_DEVICE_AUTHORIZATION_URL + XRK_MCP_OAUTH_TOKEN_URL when the IdP supports device code. " +
        `[${err.code}]`
      );
    }
    return `${err.message} [${err.code}]`;
  }
  return err instanceof Error ? err.message : String(err);
}

function oauthErrorCode(err: unknown): string {
  if (err instanceof McpOAuthDiscoveryError && isNoDeviceDiscovery(err)) {
    return "mcp-oauth-no-device";
  }
  if (err instanceof McpDeviceCodeError) return "mcp-oauth-failed";
  if (err instanceof McpOAuthDiscoveryError) return "mcp-oauth-discovery";
  // Missing URL / incomplete endpoint overrides — client validation.
  return "invalid-payload";
}

function parseServerName(payload: unknown): FaceRpcResult<string> {
  const raw = asRecord(payload).server;
  if (typeof raw !== "string" || !raw.trim()) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "server required" },
    };
  }
  const server = raw.trim();
  try {
    assertServerName(server);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  return { ok: true, value: server };
}

/** Face `mcp.oauth.status` — per-server token + in-flight login phase. */
export async function mcpOauthStatus(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<
  FaceRpcResult<{
    readonly tokenDir: string;
    readonly items: readonly (McpOAuthTokenStatus & {
      readonly loginPhase: McpOauthLoginPhase;
      readonly userCode?: string;
      readonly verificationUri?: string;
      readonly verificationUriComplete?: string;
      readonly loginError?: string;
    })[];
  }>
> {
  const p = asRecord(payload);
  const home = homeOf(runtime);
  const tokenDirOpt = tokenDirOf(runtime);
  const tokenDir = tokenDirOpt
    ? path.resolve(tokenDirOpt)
    : path.join(home, "mcp-tokens");

  let names: string[] = [];
  const serversRaw = p.servers;
  if (Array.isArray(serversRaw)) {
    for (const entry of serversRaw) {
      if (typeof entry === "string" && entry.trim()) names.push(entry.trim());
    }
  }
  if (names.length === 0) {
    try {
      for (const row of parseMcpServersValue(
        runtime.settingsNamespaces.ensure("mcp").user.servers,
      )) {
        if (row.url) names.push(row.serverName);
      }
    } catch {
      names = [];
    }
  }

  const items = [];
  for (const server of names) {
    try {
      assertServerName(server);
    } catch {
      continue;
    }
    const token = readMcpOAuthTokenStatus(server, home, {
      ...(tokenDirOpt ? { tokenDir: tokenDirOpt } : {}),
    });
    const active = activeLogins.get(server);
    const loginPhase: McpOauthLoginPhase = active
      ? active.phase
      : token.loggedIn
        ? "logged-in"
        : "idle";
    items.push({
      ...token,
      loginPhase,
      ...(active?.prompt
        ? {
            userCode: active.prompt.userCode,
            verificationUri: active.prompt.verificationUri,
            ...(active.prompt.verificationUriComplete
              ? {
                  verificationUriComplete: active.prompt.verificationUriComplete,
                }
              : {}),
          }
        : {}),
      ...(active?.error ? { loginError: active.error } : {}),
    });
  }

  return { ok: true, value: { tokenDir, items } };
}

/** Face `mcp.oauth.logout` — delete token + cancel in-flight login. */
export async function mcpOauthLogout(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<
  FaceRpcResult<{ readonly server: string; readonly status: "logged-out" | "absent" }>
> {
  const parsed = parseServerName(payload);
  if (!parsed.ok) return parsed;
  const server = parsed.value;
  const active = activeLogins.get(server);
  if (active) {
    active.abort.abort();
    active.phase = "cancelled";
    activeLogins.delete(server);
  }
  const result = logoutMcpOAuthToken(server, homeOf(runtime), tokenDirOf(runtime));
  return { ok: true, value: result };
}

/** Face `mcp.oauth.login` — start device-code; return pending prompt ASAP. */
export async function mcpOauthLogin(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<
  FaceRpcResult<{
    readonly server: string;
    readonly status: "pending" | "logged-in";
    readonly userCode?: string;
    readonly verificationUri?: string;
    readonly verificationUriComplete?: string;
    readonly expiresInSeconds?: number;
    readonly tokenFile?: string;
  }>
> {
  const parsed = parseServerName(payload);
  if (!parsed.ok) return parsed;
  const server = parsed.value;
  const p = asRecord(payload);

  const prior = activeLogins.get(server);
  if (prior?.phase === "pending" && prior.prompt) {
    return {
      ok: true,
      value: {
        server,
        status: "pending",
        userCode: prior.prompt.userCode,
        verificationUri: prior.prompt.verificationUri,
        ...(prior.prompt.verificationUriComplete
          ? { verificationUriComplete: prior.prompt.verificationUriComplete }
          : {}),
        expiresInSeconds: prior.prompt.expiresIn,
      },
    };
  }
  if (prior) {
    prior.abort.abort();
    activeLogins.delete(server);
  }

  let endpoints: McpDeviceCodeEndpoints;
  try {
    endpoints = await resolveEndpoints(runtime, server, {
      ...(typeof p.url === "string" ? { url: p.url } : {}),
      ...(typeof p.clientId === "string" ? { clientId: p.clientId } : {}),
      ...(typeof p.deviceAuthorizationUrl === "string"
        ? { deviceAuthorizationUrl: p.deviceAuthorizationUrl }
        : {}),
      ...(typeof p.tokenUrl === "string" ? { tokenUrl: p.tokenUrl } : {}),
      ...(typeof p.audience === "string" ? { audience: p.audience } : {}),
      ...(Array.isArray(p.scopes)
        ? {
            scopes: p.scopes.filter(
              (s): s is string => typeof s === "string" && Boolean(s.trim()),
            ),
          }
        : {}),
    });
  } catch (err) {
    return {
      ok: false,
      error: {
        code: oauthErrorCode(err),
        message: oauthErrorMessage(err),
      },
    };
  }

  const abort = new AbortController();
  const session: ActiveLogin = { abort, phase: "pending" };
  activeLogins.set(server, session);

  let resolvePrompt!: (start: McpDeviceCodeStart) => void;
  const promptReady = new Promise<McpDeviceCodeStart>((resolve) => {
    resolvePrompt = resolve;
  });

  const home = homeOf(runtime);
  const tokenDir = tokenDirOf(runtime);
  const loginPromise = loginWithDeviceCode(endpoints, {
    signal: abort.signal,
    onPrompt: (start) => {
      session.prompt = start;
      session.phase = "pending";
      resolvePrompt(start);
    },
  })
    .then(({ tokens }) => {
      const file = persistMcpOAuthTokens(server, home, tokens, tokenDir);
      // persist already restricts; keep chmod for older stores
      try {
        if (process.platform !== "win32") chmodSync(file, 0o600);
      } catch {
        /* ignore */
      }
      session.phase = "logged-in";
      activeLogins.delete(server);
      return file;
    })
    .catch((err: unknown) => {
      if (abort.signal.aborted) {
        session.phase = "cancelled";
      } else {
        session.phase = "error";
        session.error = oauthErrorMessage(err);
      }
      if (activeLogins.get(server) === session) {
        // keep error visible via status until next login
      }
      throw err;
    });

  void loginPromise.catch(() => {
    /* surfaced via status.loginError */
  });

  try {
    const start = await Promise.race([
      promptReady,
      loginPromise.then(
        (tokenFile) =>
          ({ kind: "done" as const, tokenFile }),
        (err: unknown) => ({ kind: "fail" as const, err }),
      ),
    ]);

    if (start && typeof start === "object" && "kind" in start) {
      if (start.kind === "done") {
        return {
          ok: true,
          value: { server, status: "logged-in", tokenFile: start.tokenFile },
        };
      }
      return {
        ok: false,
        error: {
          code: oauthErrorCode(start.err),
          message: oauthErrorMessage(start.err),
        },
      };
    }

    const prompt = start;
    return {
      ok: true,
      value: {
        server,
        status: "pending",
        userCode: prompt.userCode,
        verificationUri: prompt.verificationUri,
        ...(prompt.verificationUriComplete
          ? { verificationUriComplete: prompt.verificationUriComplete }
          : {}),
        expiresInSeconds: prompt.expiresIn,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: oauthErrorCode(err),
        message: oauthErrorMessage(err),
      },
    };
  }
}
