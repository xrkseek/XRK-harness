/**
 * MCP HTTP OAuth 2.0 device authorization grant (RFC 8628).
 *
 * Remote MCP servers behind an IdP cannot open a browser on the Host box, so
 * the login runs as a device-code flow: the Host prints a short user code, the
 * human approves it on any device, and the Host polls for a bearer token.
 *
 * Everything the flow touches is injected (`fetch` · `sleep` · `now` ·
 * `onPrompt`), so the poll loop is deterministic under test and the module
 * stays free of globals, timers, and console output.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Endpoints + client identity for one authorization server. */
export interface McpDeviceCodeEndpoints {
  /** RFC 8628 device authorization endpoint. */
  readonly deviceAuthorizationUrl: string;
  /** RFC 6749 token endpoint (also used for refresh). */
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly scopes?: readonly string[];
  /** OAuth `resource` / `audience` param when the server expects it. */
  readonly audience?: string;
}

/** What the human is shown while the flow is pending. */
export interface McpDeviceCodeStart {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  /** Prefilled URL when the server returns `verification_uri_complete`. */
  readonly verificationUriComplete?: string;
  /** Seconds until the device code expires. */
  readonly expiresIn: number;
  /** Minimum seconds between polls. */
  readonly interval: number;
}

/** A token set as persisted in the token store. */
export interface McpDeviceTokenSet {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly refreshToken?: string;
  readonly scope?: string;
  /** Epoch ms; absent when the server returned no `expires_in`. */
  readonly expiresAt?: number;
}

export type McpDeviceCodeErrorCode =
  | "device-authorization-failed"
  | "access-denied"
  | "expired-token"
  | "invalid-response"
  | "refresh-failed"
  | "aborted";

/** Failure with the OAuth error code preserved for callers / tests. */
export class McpDeviceCodeError extends Error {
  readonly code: McpDeviceCodeErrorCode;
  /** Raw OAuth `error` string when the failure came from the server. */
  readonly oauthError?: string;

  constructor(code: McpDeviceCodeErrorCode, message: string, oauthError?: string) {
    super(message);
    this.name = "McpDeviceCodeError";
    this.code = code;
    if (oauthError !== undefined) this.oauthError = oauthError;
  }
}

/** Injected side effects; all optional so prod callers pass nothing. */
export interface McpDeviceCodeDeps {
  readonly fetch?: typeof fetch;
  /** Epoch-ms clock (tests advance it with the fake sleep). */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Called once with the user code the human must approve. */
  readonly onPrompt?: (start: McpDeviceCodeStart) => void;
  /** Called before each poll after the first (progress / backoff logging). */
  readonly onPending?: (attempt: number, intervalMs: number) => void;
  readonly signal?: AbortSignal;
}

const DEFAULT_INTERVAL_SECONDS = 5;
const SLOW_DOWN_STEP_SECONDS = 5;
const EXPIRY_SKEW_MS = 30_000;

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

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** `device_authorization` response → validated start record. */
export function parseDeviceCodeResponse(raw: unknown): McpDeviceCodeStart {
  const body = asRecord(raw);
  if (!body) {
    throw new McpDeviceCodeError(
      "invalid-response",
      "device authorization returned a non-object body",
    );
  }
  const deviceCode = readString(body, "device_code");
  const userCode = readString(body, "user_code");
  const verificationUri =
    readString(body, "verification_uri") ?? readString(body, "verification_url");
  if (!deviceCode || !userCode || !verificationUri) {
    throw new McpDeviceCodeError(
      "invalid-response",
      "device authorization response missing device_code / user_code / verification_uri",
    );
  }
  const complete = readString(body, "verification_uri_complete");
  const expiresIn = readNumber(body, "expires_in") ?? 600;
  const interval = readNumber(body, "interval") ?? DEFAULT_INTERVAL_SECONDS;
  return {
    deviceCode,
    userCode,
    verificationUri,
    ...(complete ? { verificationUriComplete: complete } : {}),
    expiresIn: expiresIn > 0 ? expiresIn : 600,
    interval: interval > 0 ? interval : DEFAULT_INTERVAL_SECONDS,
  };
}

/** Token endpoint JSON → validated token set (`expiresAt` from the clock). */
export function parseTokenResponse(raw: unknown, now: () => number): McpDeviceTokenSet {
  const body = asRecord(raw);
  const accessToken = body ? readString(body, "access_token") : undefined;
  if (!body || !accessToken) {
    throw new McpDeviceCodeError(
      "invalid-response",
      "token response missing access_token",
    );
  }
  const expiresIn = readNumber(body, "expires_in");
  const refreshToken = readString(body, "refresh_token");
  const scope = readString(body, "scope");
  const tokenType = readString(body, "token_type") ?? "Bearer";
  return {
    accessToken,
    tokenType,
    ...(refreshToken ? { refreshToken } : {}),
    ...(scope ? { scope } : {}),
    ...(expiresIn !== undefined && expiresIn > 0
      ? { expiresAt: now() + expiresIn * 1000 }
      : {}),
  };
}

function formBody(fields: Readonly<Record<string, string>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) params.set(key, value);
  return params.toString();
}

async function postForm(
  url: string,
  fields: Readonly<Record<string, string>>,
  deps: McpDeviceCodeDeps,
): Promise<{ status: number; body: unknown }> {
  const doFetch = deps.fetch ?? fetch;
  const response = await doFetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: formBody(fields),
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { status: response.status, body };
}

function throwIfAborted(deps: McpDeviceCodeDeps): void {
  if (deps.signal?.aborted) {
    throw new McpDeviceCodeError("aborted", "device code login aborted");
  }
}

/** Throwing form of {@link parseDeviceCodeResponse}. */
export function assertDeviceCodeResponse(raw: unknown): McpDeviceCodeStart {
  return parseDeviceCodeResponse(raw);
}

/** Step 1: ask the authorization server for a user code. */
export async function startDeviceAuthorization(
  endpoints: McpDeviceCodeEndpoints,
  deps: McpDeviceCodeDeps = {},
): Promise<McpDeviceCodeStart> {
  throwIfAborted(deps);
  const fields: Record<string, string> = { client_id: endpoints.clientId };
  if (endpoints.scopes && endpoints.scopes.length > 0) {
    fields.scope = endpoints.scopes.join(" ");
  }
  if (endpoints.audience) fields.resource = endpoints.audience;
  const { status, body } = await postForm(
    endpoints.deviceAuthorizationUrl,
    fields,
    deps,
  );
  if (status >= 400) {
    const err = asRecord(body);
    throw new McpDeviceCodeError(
      "device-authorization-failed",
      `device authorization failed with HTTP ${status}`,
      err ? readString(err, "error") : undefined,
    );
  }
  return parseDeviceCodeResponse(body);
}

/**
 * Step 2: poll the token endpoint until the human approves, honoring
 * `authorization_pending` / `slow_down` per RFC 8628 and the device-code
 * deadline. `sleep` advances the injected clock in tests.
 */
export async function pollDeviceToken(
  endpoints: McpDeviceCodeEndpoints,
  start: McpDeviceCodeStart,
  deps: McpDeviceCodeDeps = {},
): Promise<McpDeviceTokenSet> {
  const now = deps.now ?? (() => Date.now());
  const sleep =
    deps.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  const deadline = now() + start.expiresIn * 1000;
  let intervalSeconds = start.interval;
  let attempt = 0;
  for (;;) {
    throwIfAborted(deps);
    await sleep(intervalSeconds * 1000);
    throwIfAborted(deps);
    attempt += 1;
    const { status, body } = await postForm(
      endpoints.tokenUrl,
      {
        client_id: endpoints.clientId,
        device_code: start.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      },
      deps,
    );
    if (status < 400) return parseTokenResponse(body, now);
    const err = asRecord(body);
    const code = err ? readString(err, "error") : undefined;
    if (code === "authorization_pending") {
      deps.onPending?.(attempt, intervalSeconds * 1000);
      if (now() >= deadline) {
        throw new McpDeviceCodeError(
          "expired-token",
          "device code expired before approval",
          code,
        );
      }
      continue;
    }
    if (code === "slow_down") {
      intervalSeconds += SLOW_DOWN_STEP_SECONDS;
      deps.onPending?.(attempt, intervalSeconds * 1000);
      if (now() >= deadline) {
        throw new McpDeviceCodeError(
          "expired-token",
          "device code expired before approval",
          code,
        );
      }
      continue;
    }
    if (code === "access_denied") {
      throw new McpDeviceCodeError(
        "access-denied",
        "device code authorization was denied",
        code,
      );
    }
    if (code === "expired_token") {
      throw new McpDeviceCodeError(
        "expired-token",
        "device code expired before approval",
        code,
      );
    }
    throw new McpDeviceCodeError(
      "device-authorization-failed",
      `token request failed with HTTP ${status}`,
      code,
    );
  }
}

/** Full login: start, announce the user code, then poll to completion. */
export async function loginWithDeviceCode(
  endpoints: McpDeviceCodeEndpoints,
  deps: McpDeviceCodeDeps = {},
): Promise<{ start: McpDeviceCodeStart; tokens: McpDeviceTokenSet }> {
  const start = await startDeviceAuthorization(endpoints, deps);
  deps.onPrompt?.(start);
  const tokens = await pollDeviceToken(endpoints, start, deps);
  return { start, tokens };
}

/** Exchange a refresh token (no device code involved). */
export async function refreshDeviceToken(
  endpoints: McpDeviceCodeEndpoints,
  refreshToken: string,
  deps: McpDeviceCodeDeps = {},
): Promise<McpDeviceTokenSet> {
  const now = deps.now ?? (() => Date.now());
  throwIfAborted(deps);
  const { status, body } = await postForm(
    endpoints.tokenUrl,
    {
      client_id: endpoints.clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
    deps,
  );
  if (status >= 400) {
    const err = asRecord(body);
    throw new McpDeviceCodeError(
      "refresh-failed",
      `token refresh failed with HTTP ${status}`,
      err ? readString(err, "error") : undefined,
    );
  }
  const fresh = parseTokenResponse(body, now);
  // A refresh response often omits refresh_token; keep the old one.
  return fresh.refreshToken ? fresh : { ...fresh, refreshToken };
}

/** True when the token is absent an expiry or is inside the skew window. */
export function isTokenExpired(
  tokens: McpDeviceTokenSet | undefined,
  now: () => number = () => Date.now(),
  skewMs: number = EXPIRY_SKEW_MS,
): boolean {
  if (!tokens?.accessToken) return true;
  if (tokens.expiresAt === undefined) return false;
  return now() >= tokens.expiresAt - skewMs;
}

/** Request headers for the MCP HTTP transport. */
export function deviceAuthorizationHeaders(
  tokens: McpDeviceTokenSet,
): Record<string, string> {
  const scheme = tokens.tokenType?.trim() || "Bearer";
  return { authorization: `${scheme} ${tokens.accessToken}` };
}

/**
 * Merge auth headers onto a transport `requestInit` without dropping any
 * caller-supplied headers (case-insensitive, via `Headers`).
 * Returns `undefined` when there is nothing to send.
 */
export function mergeAuthHeaders(
  requestInit: RequestInit | undefined,
  headers: Readonly<Record<string, string>> | undefined,
): RequestInit | undefined {
  const entries = headers ? Object.entries(headers) : [];
  if (entries.length === 0) return requestInit;
  const merged = new Headers(requestInit?.headers);
  for (const [key, value] of entries) merged.set(key, value);
  return { ...requestInit, headers: merged };
}

interface PersistedShape {
  readonly tokens?: McpDeviceTokenSet;
}

/**
 * Best-effort atomic JSON write (tmp + rename) so a crash cannot leave a
 * truncated token file. Persisting tokens is never session truth: failures
 * are swallowed and the caller stays logged in for this process.
 */
function writeJsonAtomic(file: string, payload: unknown): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(tmp, file);
  } catch {
    try {
      rmSync(`${file}.tmp-${process.pid}`, { force: true });
    } catch {
      /* best effort */
    }
  }
}

/**
 * Token store for one MCP server: JSON sidecar beside the session dir.
 * `headers()` refreshes through the injected fetch when the access token is
 * expired and a refresh token is available.
 */
export class McpDeviceTokenStore {
  private tokens: McpDeviceTokenSet | undefined;

  constructor(private readonly persistPath?: string) {
    if (persistPath) this.load();
  }

  get(): McpDeviceTokenSet | undefined {
    return this.tokens;
  }

  set(tokens: McpDeviceTokenSet | undefined): void {
    this.tokens = tokens;
    this.save();
  }

  clear(): void {
    this.set(undefined);
  }

  /**
   * Headers to attach to the transport `requestInit`.
   * Refreshes first when expired and a refresh token + endpoints are given.
   */
  async headers(
    endpoints?: McpDeviceCodeEndpoints,
    deps: McpDeviceCodeDeps = {},
  ): Promise<Record<string, string>> {
    const current = this.tokens;
    if (!current) return {};
    const now = deps.now ?? (() => Date.now());
    if (!isTokenExpired(current, now)) return deviceAuthorizationHeaders(current);
    if (!endpoints || !current.refreshToken) {
      return deviceAuthorizationHeaders(current);
    }
    const refreshed = await refreshDeviceToken(endpoints, current.refreshToken, deps);
    this.set(refreshed);
    return deviceAuthorizationHeaders(refreshed);
  }

  private load(): void {
    const file = this.persistPath;
    if (!file) return;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as PersistedShape;
      const tokens = raw.tokens;
      if (tokens && typeof tokens.accessToken === "string" && tokens.accessToken) {
        this.tokens = tokens;
      }
    } catch {
      /* missing / corrupt sidecar → logged out */
    }
  }

  private save(): void {
    const file = this.persistPath;
    if (!file) return;
    writeJsonAtomic(file, {
      ...(this.tokens ? { tokens: this.tokens } : {}),
    } satisfies PersistedShape);
  }
}
