/**
 * Product-path helpers for MCP device-code tokens (CLI + Face Settings).
 *
 * Token files live at `<XRK_HOME>/mcp-tokens/<server>.json` — the same layout
 * `xrkh mcp login|status|logout` uses. Callers supply the resolved home so this
 * module stays free of Face/CLI coupling.
 */
import { chmodSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import {
  McpDeviceTokenStore,
  isTokenExpired,
  type McpDeviceTokenSet,
} from "./oauth-device.js";
import { assertServerName } from "./names.js";

/** `<home>/mcp-tokens` (override with `tokenDir`). */
export function mcpOAuthTokenDir(
  homeDir: string,
  tokenDir?: string,
): string {
  const override = tokenDir?.trim();
  if (override) return path.resolve(override);
  return path.join(path.resolve(homeDir), "mcp-tokens");
}

/** `<token-dir>/<server>.json`; validates the server name first. */
export function mcpOAuthTokenFile(
  server: string,
  homeDir: string,
  tokenDir?: string,
): string {
  const name = server.trim();
  assertServerName(name);
  return path.join(mcpOAuthTokenDir(homeDir, tokenDir), `${name}.json`);
}

/** Best-effort 0600 so other accounts cannot read a bearer token. */
export function restrictMcpOAuthTokenFile(file: string): void {
  if (process.platform === "win32") return;
  try {
    chmodSync(file, 0o600);
  } catch {
    /* ACLs / exotic filesystems: the token is still usable */
  }
}

/** Wire-safe status for one server's on-disk token (no secrets). */
export type McpOAuthTokenStatus = {
  readonly server: string;
  readonly tokenFile: string;
  readonly loggedIn: boolean;
  readonly expired?: boolean;
  readonly expiresAt?: number;
  readonly scope?: string;
  readonly hasRefreshToken?: boolean;
};

/** Read token status without exposing the bearer. */
export function readMcpOAuthTokenStatus(
  server: string,
  homeDir: string,
  options: {
    readonly tokenDir?: string;
    readonly now?: () => number;
  } = {},
): McpOAuthTokenStatus {
  const now = options.now ?? (() => Date.now());
  const tokenFile = mcpOAuthTokenFile(server, homeDir, options.tokenDir);
  const tokens = new McpDeviceTokenStore(tokenFile).get();
  return summarizeMcpOAuthTokens(server, tokenFile, tokens, now);
}

export function summarizeMcpOAuthTokens(
  server: string,
  tokenFile: string,
  tokens: McpDeviceTokenSet | undefined,
  now: () => number,
): McpOAuthTokenStatus {
  if (!tokens) {
    return { server, tokenFile, loggedIn: false };
  }
  return {
    server,
    tokenFile,
    loggedIn: true,
    expired: isTokenExpired(tokens, now),
    ...(tokens.expiresAt !== undefined ? { expiresAt: tokens.expiresAt } : {}),
    ...(tokens.scope ? { scope: tokens.scope } : {}),
    hasRefreshToken: Boolean(tokens.refreshToken),
  };
}

/** Delete the token file; returns whether a file existed. */
export function logoutMcpOAuthToken(
  server: string,
  homeDir: string,
  tokenDir?: string,
): { readonly server: string; readonly status: "logged-out" | "absent" } {
  const file = mcpOAuthTokenFile(server, homeDir, tokenDir);
  const existed = existsSync(file);
  if (existed) rmSync(file, { force: true });
  return { server, status: existed ? "logged-out" : "absent" };
}

/** Persist tokens after a successful device-code poll. */
export function persistMcpOAuthTokens(
  server: string,
  homeDir: string,
  tokens: McpDeviceTokenSet,
  tokenDir?: string,
): string {
  const file = mcpOAuthTokenFile(server, homeDir, tokenDir);
  new McpDeviceTokenStore(file).set(tokens);
  restrictMcpOAuthTokenFile(file);
  return file;
}
