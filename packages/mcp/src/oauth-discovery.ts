/**
 * MCP OAuth discovery: RFC 9728 protected-resource metadata + RFC 8414 /
 * OIDC authorization-server metadata.
 *
 * An HTTP MCP server that needs OAuth publishes (a) which authorization
 * servers it trusts and (b) where to log in. Rather than making the operator
 * hand-copy three endpoints, the Host walks the same well-known documents a
 * spec-compliant client does and hands back {@link McpDeviceCodeEndpoints}.
 *
 * `fetch` (and an optional `signal`) are injected, so the walk is deterministic
 * under test and the module has no globals.
 */
import type { McpDeviceCodeEndpoints } from "./oauth-device.js";

/** RFC 9728 protected-resource metadata, narrowed to what a login needs. */
export interface McpProtectedResourceMetadata {
  /** Canonical resource identifier (used as the OAuth `resource` audience). */
  readonly resource?: string;
  readonly authorizationServers: readonly string[];
  readonly scopesSupported: readonly string[];
  /** Document URL the metadata was read from (or the `resource_metadata` hint). */
  readonly metadataUrl?: string;
}

/** RFC 8414 / OIDC authorization-server metadata, narrowed to a login need. */
export interface McpAuthorizationServerMetadata {
  readonly issuer?: string;
  readonly deviceAuthorizationUrl: string;
  readonly tokenUrl: string;
  readonly registrationUrl?: string;
  readonly scopesSupported: readonly string[];
  /** Document URL the metadata was read from. */
  readonly metadataUrl?: string;
}

export type McpOAuthDiscoveryErrorCode =
  /** A document was not an object, or was missing a required field. */
  | "invalid-response"
  /** A document could not be fetched (network error / non-2xx everywhere). */
  | "request-failed"
  /** Fetched documents were fine but do not describe a device-code login. */
  | "unsupported";

/** Failure with a stable code so callers can print an actionable message. */
export class McpOAuthDiscoveryError extends Error {
  readonly code: McpOAuthDiscoveryErrorCode;
  readonly status?: number;

  constructor(code: McpOAuthDiscoveryErrorCode, message: string, status?: number) {
    super(message);
    this.name = "McpOAuthDiscoveryError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

/** Injected side effects; all optional so prod callers pass nothing. */
export interface McpOAuthDiscoveryDeps {
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}

function asRecord(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as Record<string, unknown>;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Array of non-empty trimmed strings (drops non-strings). */
function readStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

function parseUrl(raw: string, what: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw new McpOAuthDiscoveryError(
      "invalid-response",
      `${what} is not a valid absolute URL: ${JSON.stringify(raw)}`,
    );
  }
}

/**
 * Well-known paths for a resource, most specific first. RFC 9728 keeps the
 * resource's path as a suffix; the bare origin form is the fallback.
 */
export function protectedResourceMetadataUrls(resourceUrl: string): string[] {
  const url = parseUrl(resourceUrl, "resourceUrl");
  const base = url.origin;
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  const candidates = [
    path ? `${base}/.well-known/oauth-protected-resource${path}` : undefined,
    `${base}/.well-known/oauth-protected-resource`,
  ];
  return [...new Set(candidates.filter((x): x is string => Boolean(x)))];
}

/**
 * Well-known paths for an issuer, most specific first. RFC 8414 inserts the
 * issuer path after the well-known segment; OIDC appends it after the issuer.
 */
export function authorizationServerMetadataUrls(issuerUrl: string): string[] {
  const url = parseUrl(issuerUrl, "issuerUrl");
  const base = url.origin;
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  const candidates = [
    `${base}/.well-known/oauth-authorization-server${path}`,
    path ? `${base}/.well-known/openid-configuration${path}` : undefined,
    path ? `${base}${path}/.well-known/openid-configuration` : undefined,
    `${base}/.well-known/oauth-authorization-server`,
    `${base}/.well-known/openid-configuration`,
  ];
  return [...new Set(candidates.filter((x): x is string => Boolean(x)))];
}

/** `Bearer resource_metadata="…"` from a 401 challenge, when present. */
export function parseResourceMetadataChallenge(
  header: string | null | undefined,
): string | undefined {
  if (!header) return undefined;
  const match = /resource_metadata\s*=\s*"([^"]+)"/i.exec(header);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : undefined;
}

/** Throwing form for a protected-resource metadata document. */
export function parseProtectedResourceMetadata(
  raw: unknown,
): McpProtectedResourceMetadata {
  const body = asRecord(raw);
  if (!body) {
    throw new McpOAuthDiscoveryError(
      "invalid-response",
      "protected resource metadata is not a JSON object",
    );
  }
  const resource = readString(body, "resource");
  return {
    ...(resource ? { resource } : {}),
    authorizationServers: readStringArray(body, "authorization_servers"),
    scopesSupported: readStringArray(body, "scopes_supported"),
  };
}

/** Throwing form for an authorization-server metadata document. */
export function parseAuthorizationServerMetadata(
  raw: unknown,
): McpAuthorizationServerMetadata {
  const body = asRecord(raw);
  if (!body) {
    throw new McpOAuthDiscoveryError(
      "invalid-response",
      "authorization server metadata is not a JSON object",
    );
  }
  const tokenUrl = readString(body, "token_endpoint");
  if (!tokenUrl) {
    throw new McpOAuthDiscoveryError(
      "invalid-response",
      "authorization server metadata has no token_endpoint",
    );
  }
  const deviceAuthorizationUrl = readString(body, "device_authorization_endpoint");
  if (!deviceAuthorizationUrl) {
    throw new McpOAuthDiscoveryError(
      "unsupported",
      "authorization server does not advertise device_authorization_endpoint (RFC 8628 device flow)",
    );
  }
  const issuer = readString(body, "issuer");
  const registrationUrl = readString(body, "registration_endpoint");
  return {
    ...(issuer ? { issuer } : {}),
    deviceAuthorizationUrl,
    tokenUrl,
    ...(registrationUrl ? { registrationUrl } : {}),
    scopesSupported: readStringArray(body, "scopes_supported"),
  };
}

interface JsonDocument {
  readonly status: number;
  readonly body: unknown;
}

/** GET a URL and parse JSON; `undefined` when the request itself failed. */
async function tryGetJson(
  url: string,
  deps: McpOAuthDiscoveryDeps,
): Promise<JsonDocument | undefined> {
  const doFetch = deps.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
  } catch {
    return undefined;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { status: response.status, body };
}

/** First well-known document that parses; the 401 challenge as a fallback. */
export async function discoverProtectedResource(
  resourceUrl: string,
  deps: McpOAuthDiscoveryDeps = {},
): Promise<McpProtectedResourceMetadata> {
  const problems: string[] = [];
  for (const candidate of protectedResourceMetadataUrls(resourceUrl)) {
    const doc = await tryGetJson(candidate, deps);
    if (!doc || doc.status >= 400) {
      problems.push(`${candidate} → ${doc ? `HTTP ${doc.status}` : "unreachable"}`);
      continue;
    }
    const parsed = parseProtectedResourceMetadata(doc.body);
    return { ...parsed, metadataUrl: candidate };
  }

  // Some deployments only answer the challenge from the resource itself.
  const doFetch = deps.fetch ?? fetch;
  let probe: Response | undefined;
  try {
    probe = await doFetch(resourceUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
  } catch {
    probe = undefined;
  }
  const hinted = parseResourceMetadataChallenge(probe?.headers.get("www-authenticate"));
  if (hinted) {
    const doc = await tryGetJson(hinted, deps);
    if (doc && doc.status < 400) {
      const parsed = parseProtectedResourceMetadata(doc.body);
      return { ...parsed, metadataUrl: hinted };
    }
    problems.push(`${hinted} (WWW-Authenticate hint) → unreachable`);
  }

  throw new McpOAuthDiscoveryError(
    "request-failed",
    `no protected resource metadata for ${resourceUrl}: ${problems.join("; ") || "no document"}`,
  );
}

/** First well-known authorization-server document that parses. */
export async function discoverAuthorizationServerMetadata(
  issuerUrl: string,
  deps: McpOAuthDiscoveryDeps = {},
): Promise<McpAuthorizationServerMetadata> {
  const problems: string[] = [];
  for (const candidate of authorizationServerMetadataUrls(issuerUrl)) {
    const doc = await tryGetJson(candidate, deps);
    if (!doc || doc.status >= 400) {
      problems.push(`${candidate} → ${doc ? `HTTP ${doc.status}` : "unreachable"}`);
      continue;
    }
    let parsed: McpAuthorizationServerMetadata;
    try {
      parsed = parseAuthorizationServerMetadata(doc.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      problems.push(`${candidate} → ${message}`);
      continue;
    }
    return { ...parsed, metadataUrl: candidate };
  }
  throw new McpOAuthDiscoveryError(
    "request-failed",
    `no authorization server metadata for ${issuerUrl}: ${problems.join("; ") || "no document"}`,
  );
}

export interface McpDeviceCodeDiscoveryInput {
  /** URL of the MCP server (its transport endpoint). */
  readonly resourceUrl: string;
  readonly clientId: string;
  /** Overrides `scopes_supported` from discovery. */
  readonly scopes?: readonly string[];
  /** Overrides the discovered `resource` audience. */
  readonly audience?: string;
  readonly deps?: McpOAuthDiscoveryDeps;
}

export interface McpDeviceCodeDiscoveryResult {
  readonly endpoints: McpDeviceCodeEndpoints;
  readonly protectedResource: McpProtectedResourceMetadata;
  readonly authorizationServer: McpAuthorizationServerMetadata;
}

/**
 * Full discovery: resource metadata → authorization server → token endpoints.
 * The discovered `resource` becomes the `resource` audience param when the
 * metadata names one, so audience-bound servers accept the token.
 */
export async function discoverDeviceCodeEndpoints(
  input: McpDeviceCodeDiscoveryInput,
): Promise<McpDeviceCodeDiscoveryResult> {
  const deps = input.deps ?? {};
  const protectedResource = await discoverProtectedResource(input.resourceUrl, deps);
  const issuer = protectedResource.authorizationServers[0];
  if (!issuer) {
    throw new McpOAuthDiscoveryError(
      "unsupported",
      `protected resource metadata for ${input.resourceUrl} advertises no authorization_servers`,
    );
  }
  const authorizationServer = await discoverAuthorizationServerMetadata(issuer, deps);
  const scopes = input.scopes ?? protectedResource.scopesSupported;
  const audience = input.audience ?? protectedResource.resource;
  return {
    endpoints: {
      deviceAuthorizationUrl: authorizationServer.deviceAuthorizationUrl,
      tokenUrl: authorizationServer.tokenUrl,
      clientId: input.clientId,
      ...(scopes.length > 0 ? { scopes } : {}),
      ...(audience ? { audience } : {}),
    },
    protectedResource,
    authorizationServer,
  };
}
