/**
 * `xrkh mcp` — OAuth 2.0 device-code login for HTTP MCP servers.
 *
 * Remote MCP servers behind an IdP cannot open a browser on the Host box, so
 * login is a device-code flow (RFC 8628): print a short user code, the human
 * approves it anywhere, the CLI polls for a bearer token and persists it beside
 * the product home. Endpoints come from explicit flags/env, or from RFC 9728 /
 * RFC 8414 discovery against the server URL from `XRK_MCP_SERVERS` or
 * `~/.xrk/host-settings.json`.
 *
 * The flow itself lives in `@xrkseek/mcp`; this file owns argument parsing,
 * config lookup, on-disk token placement and terminal output.
 */
import { chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  McpDeviceCodeError,
  McpDeviceTokenStore,
  McpOAuthDiscoveryError,
  assertServerName,
  discoverDeviceCodeEndpoints,
  isTokenExpired,
  loginWithDeviceCode,
  type McpDeviceCodeEndpoints,
  type McpDeviceTokenSet,
} from "@xrkseek/mcp";
import { parseMcpServersValue } from "@xrkseek/server-config";
import { resolveConfiguredXrkHome } from "@xrkseek/xrk-home-paths";

export function mcpHelpText(): string {
  return `xrkh mcp — OAuth login for HTTP MCP servers (bin also: xrk-harness)

Usage:
  xrkh mcp login <server> [options]
  xrkh mcp logout <server>
  xrkh mcp status [<server>…] [--json]
  xrkh mcp list [--json]
  xrkh mcp path
  xrkh mcp help

Login options:
  --url <url>                     MCP server URL (else resolved from config)
  --client-id <id>                OAuth client id
  --device-authorization-url <u>  RFC 8628 device endpoint (skip discovery)
  --token-url <u>                 Token endpoint (skip discovery)
  --scope <a,b>                   Space/comma separated scopes (repeatable)
  --audience <resource>           OAuth resource / audience param
  --no-discovery                  Require explicit endpoints or env
  --token-dir <path>              Token dir (default: <XRK_HOME>/mcp-tokens)
  --json                          Print one JSON object on stdout

Behaviour:
  • Without --device-authorization-url / --token-url, endpoints are discovered
    from the server's RFC 9728 protected-resource + RFC 8414 authorization
    server metadata (needs --url, XRK_MCP_SERVERS, or host-settings.json).
  • The token file is <token-dir>/<server>.json, written 0600 where possible.
  • Login fails closed: no token is written unless the poll succeeds.

Env:
  XRK_MCP_OAUTH_CLIENT_ID                 OAuth client id
  XRK_MCP_OAUTH_DEVICE_AUTHORIZATION_URL  Device endpoint (skip discovery)
  XRK_MCP_OAUTH_TOKEN_URL                 Token endpoint (skip discovery)
  XRK_MCP_OAUTH_SCOPES                    Space/comma separated scopes
  XRK_MCP_OAUTH_AUDIENCE                  OAuth resource / audience param
  XRK_MCP_OAUTH_TOKEN_DIR                 Token dir (default: <XRK_HOME>/mcp-tokens)
  XRK_MCP_SERVERS                         Server list JSON (name → url)
  XRK_MCP_OAUTH_SERVERS_FILE              Settings JSON holding the server list

Examples:
  xrkh mcp login linear --client-id xrk-cli
  xrkh mcp login linear --url https://mcp.linear.app/mcp --client-id xrk-cli
  xrkh mcp status --json
  xrkh mcp logout linear
`;
}

/** Injected side effects so the flow is deterministic under test. */
export interface McpCommandDeps {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Overrides the product home used for the default token dir. */
  readonly homeDir?: string;
  readonly env?: NodeJS.ProcessEnv;
}

interface McpFlags {
  readonly server?: string;
  readonly url?: string;
  readonly clientId?: string;
  readonly deviceAuthorizationUrl?: string;
  readonly tokenUrl?: string;
  readonly scopes: readonly string[];
  readonly audience?: string;
  readonly noDiscovery: boolean;
  readonly json: boolean;
  readonly tokenDir?: string;
  readonly serversFile?: string;
}

function splitScopes(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseMcpFlags(argv: readonly string[]): {
  readonly positionals: readonly string[];
  readonly flags: McpFlags;
} {
  const rest = [...argv];
  const positionals: string[] = [];
  const scopes: string[] = [];
  let url: string | undefined;
  let clientId: string | undefined;
  let deviceAuthorizationUrl: string | undefined;
  let tokenUrl: string | undefined;
  let audience: string | undefined;
  let noDiscovery = false;
  let json = false;
  let tokenDir: string | undefined;
  let serversFile: string | undefined;

  const takeValue = (flag: string, inline?: string): string => {
    if (inline !== undefined) {
      if (!inline.trim()) throw new Error(`${flag} needs a value`);
      return inline;
    }
    const next = rest.shift();
    if (next === undefined || !next.trim()) {
      throw new Error(`${flag} needs a value`);
    }
    return next;
  };

  /** `--x value` / `--x=value` for one flag. */
  const value = (flag: string, a: string): string | undefined => {
    if (a === flag) return takeValue(flag);
    if (a.startsWith(`${flag}=`)) {
      return takeValue(flag, a.slice(flag.length + 1));
    }
    return undefined;
  };

  while (rest.length > 0) {
    const a = rest.shift()!;
    const u = value("--url", a);
    if (u !== undefined) {
      url = u;
      continue;
    }
    const c = value("--client-id", a);
    if (c !== undefined) {
      clientId = c;
      continue;
    }
    const d = value("--device-authorization-url", a);
    if (d !== undefined) {
      deviceAuthorizationUrl = d;
      continue;
    }
    const t = value("--token-url", a);
    if (t !== undefined) {
      tokenUrl = t;
      continue;
    }
    const s = value("--scope", a);
    if (s !== undefined) {
      scopes.push(...splitScopes(s));
      continue;
    }
    const aud = value("--audience", a);
    if (aud !== undefined) {
      audience = aud;
      continue;
    }
    const dir = value("--token-dir", a);
    if (dir !== undefined) {
      tokenDir = dir;
      continue;
    }
    const sf = value("--servers-file", a);
    if (sf !== undefined) {
      serversFile = sf;
      continue;
    }
    if (a === "--no-discovery") {
      noDiscovery = true;
      continue;
    }
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a.startsWith("-") && a !== "-") {
      throw new Error(`unknown flag: ${a}`);
    }
    positionals.push(a);
  }

  return {
    positionals,
    flags: {
      ...(positionals[0] !== undefined ? { server: positionals[0] } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(clientId !== undefined ? { clientId } : {}),
      ...(deviceAuthorizationUrl !== undefined ? { deviceAuthorizationUrl } : {}),
      ...(tokenUrl !== undefined ? { tokenUrl } : {}),
      scopes,
      ...(audience !== undefined ? { audience } : {}),
      noDiscovery,
      json,
      ...(tokenDir !== undefined ? { tokenDir } : {}),
      ...(serversFile !== undefined ? { serversFile } : {}),
    },
  };
}

/** `<home>/mcp-tokens`, honoring `XRK_HOME` and an explicit override. */
export function defaultTokenDir(deps: McpCommandDeps = {}): string {
  return path.join(resolveConfiguredXrkHome(deps.homeDir, deps.env), "mcp-tokens");
}

/** `<token-dir>/<server>.json`; the server name is validated first. */
export function resolveTokenFile(
  server: string,
  options: {
    readonly tokenDir?: string;
    readonly homeDir?: string;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): string {
  const name = server.trim();
  assertServerName(name);
  const dir = options.tokenDir?.trim() || defaultTokenDir(options);
  return path.join(path.resolve(dir), `${name}.json`);
}

/** Token-file placement derived from flags + injected deps. */
function tokenOptions(
  flags: McpFlags,
  deps: McpCommandDeps,
): {
  readonly tokenDir?: string;
  readonly homeDir?: string;
  readonly env?: NodeJS.ProcessEnv;
} {
  const env = deps.env ?? process.env;
  const dir = flags.tokenDir?.trim() || env.XRK_MCP_OAUTH_TOKEN_DIR?.trim();
  return {
    ...(dir ? { tokenDir: dir } : {}),
    ...(deps.homeDir !== undefined ? { homeDir: deps.homeDir } : {}),
    ...(deps.env !== undefined ? { env: deps.env } : {}),
  };
}

/** Best-effort 0600 so other accounts cannot read a bearer token. */
function restrictTokenFile(file: string): void {
  if (process.platform === "win32") return;
  try {
    chmodSync(file, 0o600);
  } catch {
    /* ACLs / exotic filesystems: the token is still usable */
  }
}

interface ConfiguredServer {
  readonly serverName: string;
  readonly url?: string;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/** Server rows from `XRK_MCP_SERVERS`, else the settings document. */
function configuredServers(flags: McpFlags, deps: McpCommandDeps): ConfiguredServer[] {
  const env = deps.env ?? process.env;
  const rows: ConfiguredServer[] = [];
  const push = (value: unknown): void => {
    for (const row of parseMcpServersValue(value)) {
      rows.push({
        serverName: row.serverName,
        ...(row.url ? { url: row.url } : {}),
      });
    }
  };

  const fromEnv = env.XRK_MCP_SERVERS?.trim();
  if (fromEnv) {
    try {
      push(JSON.parse(fromEnv));
    } catch {
      throw new Error("XRK_MCP_SERVERS must be valid JSON");
    }
  }

  const file =
    flags.serversFile?.trim() ||
    env.XRK_MCP_OAUTH_SERVERS_FILE?.trim() ||
    path.join(resolveConfiguredXrkHome(deps.homeDir, deps.env), "host-settings.json");
  if (existsSync(file)) {
    const doc = readJson(file);
    if (doc && typeof doc === "object" && !Array.isArray(doc)) {
      const record = doc as Record<string, unknown>;
      push(record.servers ?? record.mcp ?? record);
    }
  }
  return rows;
}

function lookupServerUrl(
  server: string,
  flags: McpFlags,
  deps: McpCommandDeps,
): string | undefined {
  if (flags.url?.trim()) return flags.url.trim();
  const env = deps.env ?? process.env;
  for (const row of configuredServers(flags, deps)) {
    if (row.serverName === server) return row.url;
  }
  const fromEnv = env.XRK_MCP_OAUTH_URL?.trim();
  return fromEnv || undefined;
}

/** Explicit flags/env win; otherwise discover from the server URL. */
async function resolveEndpoints(
  server: string,
  flags: McpFlags,
  deps: McpCommandDeps,
): Promise<McpDeviceCodeEndpoints> {
  const env = deps.env ?? process.env;
  const deviceAuthorizationUrl =
    flags.deviceAuthorizationUrl ?? env.XRK_MCP_OAUTH_DEVICE_AUTHORIZATION_URL?.trim();
  const tokenUrl = flags.tokenUrl ?? env.XRK_MCP_OAUTH_TOKEN_URL?.trim();
  const clientId = flags.clientId ?? env.XRK_MCP_OAUTH_CLIENT_ID?.trim();
  const audience = flags.audience ?? env.XRK_MCP_OAUTH_AUDIENCE?.trim();
  const scopes =
    flags.scopes.length > 0
      ? flags.scopes
      : splitScopes(env.XRK_MCP_OAUTH_SCOPES ?? "");

  if (!clientId) {
    throw new Error(
      `no OAuth client id for ${server}: pass --client-id or set XRK_MCP_OAUTH_CLIENT_ID`,
    );
  }

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
      "incomplete OAuth endpoints: pass both --device-authorization-url and --token-url",
    );
  }

  if (flags.noDiscovery) {
    throw new Error("--no-discovery needs --device-authorization-url and --token-url");
  }

  const resourceUrl = lookupServerUrl(server, flags, deps);
  if (!resourceUrl) {
    throw new Error(
      `no URL for MCP server "${server}": pass --url, configure it in mcp.servers, or set XRK_MCP_SERVERS`,
    );
  }
  const discovered = await discoverDeviceCodeEndpoints({
    resourceUrl,
    clientId,
    ...(scopes.length > 0 ? { scopes } : {}),
    ...(audience ? { audience } : {}),
    deps: {
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    },
  });
  return discovered.endpoints;
}

function describeToken(tokens: McpDeviceTokenSet): string {
  const parts: string[] = [];
  if (tokens.scope) parts.push(`scope=${tokens.scope}`);
  if (tokens.refreshToken) parts.push("refresh=yes");
  return parts.join(" ");
}

function tokenStateLine(
  server: string,
  tokens: McpDeviceTokenSet | undefined,
  now: () => number,
): string {
  if (!tokens) return `${server}\tlogged-out`;
  const detail = describeToken(tokens);
  const suffix = detail ? `\t${detail}` : "";
  if (isTokenExpired(tokens, now)) return `${server}\texpired${suffix}`;
  if (tokens.expiresAt === undefined) return `${server}\tvalid (no expiry)${suffix}`;
  const mins = Math.max(0, Math.round((tokens.expiresAt - now()) / 60_000));
  return `${server}\tvalid ~${mins}m${suffix}`;
}

function writeJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function errorMessage(err: unknown): string {
  if (err instanceof McpDeviceCodeError) {
    return `${err.message} [${err.code}${err.oauthError ? `:${err.oauthError}` : ""}]`;
  }
  if (err instanceof McpOAuthDiscoveryError) {
    return `${err.message} [${err.code}]`;
  }
  return err instanceof Error ? err.message : String(err);
}

export async function runMcp(
  argv: readonly string[],
  deps: McpCommandDeps = {},
): Promise<number> {
  const raw = [...argv];
  if (raw.length === 0 || raw[0] === "help" || raw[0] === "--help" || raw[0] === "-h") {
    process.stdout.write(mcpHelpText());
    return 0;
  }

  const sub = raw.shift()!;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());

  try {
    const { positionals, flags } = parseMcpFlags(raw);
    const tokenDir =
      flags.tokenDir?.trim() || env.XRK_MCP_OAUTH_TOKEN_DIR?.trim() || undefined;

    switch (sub) {
      case "login": {
        const server = flags.server;
        if (!server) throw new Error("mcp login needs a <server> name");
        assertServerName(server);
        const endpoints = await resolveEndpoints(server, flags, deps);
        const file = resolveTokenFile(server, tokenOptions(flags, deps));

        const jwt = flags.json;
        if (!jwt) {
          process.stdout.write(`MCP login: ${server}\n`);
        }
        const { tokens } = await loginWithDeviceCode(endpoints, {
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
          now,
          ...(deps.sleep ? { sleep: deps.sleep } : {}),
          onPrompt: (start) => {
            if (jwt) {
              writeJson({
                server,
                status: "pending",
                verificationUri: start.verificationUri,
                ...(start.verificationUriComplete
                  ? { verificationUriComplete: start.verificationUriComplete }
                  : {}),
                userCode: start.userCode,
                expiresInSeconds: start.expiresIn,
              });
              return;
            }
            process.stdout.write(
              `  open   ${start.verificationUriComplete ?? start.verificationUri}\n` +
                `  code   ${start.userCode}\n` +
                `  (expires in ${Math.round(start.expiresIn / 60)}m)\n`,
            );
          },
          onPending: (attempt, intervalMs) => {
            if (!jwt) {
              process.stderr.write(
                `waiting for approval (attempt ${attempt}, every ${Math.round(intervalMs / 1000)}s)…\n`,
              );
            }
          },
        });

        const store = new McpDeviceTokenStore(file);
        store.set(tokens);
        restrictTokenFile(file);

        if (flags.json) {
          writeJson({
            server,
            status: "logged-in",
            tokenFile: file,
            ...(tokens.expiresAt !== undefined ? { expiresAt: tokens.expiresAt } : {}),
            ...(tokens.scope ? { scope: tokens.scope } : {}),
            hasRefreshToken: Boolean(tokens.refreshToken),
          });
        } else {
          process.stdout.write(
            `logged in ${server} (${describeToken(tokens) || "no scope"}) → ${file}\n`,
          );
        }
        return 0;
      }

      case "logout": {
        const server = flags.server;
        if (!server) throw new Error("mcp logout needs a <server> name");
        const file = resolveTokenFile(server, tokenOptions(flags, deps));
        const existed = existsSync(file);
        if (existed) rmSync(file, { force: true });
        if (flags.json)
          writeJson({ server, status: existed ? "logged-out" : "absent" });
        else
          process.stdout.write(
            `${existed ? "logged out" : "no token for"} ${server}\n`,
          );
        return 0;
      }

      case "status": {
        // `status [server…]` — every positional is a server name.
        const names =
          positionals.length > 0
            ? positionals
            : configuredServers(flags, deps).map((row) => row.serverName);
        if (names.length === 0) {
          throw new Error(
            "mcp status needs a <server> name or a configured mcp.servers list",
          );
        }
        const lines: unknown[] = [];
        for (const server of names) {
          assertServerName(server);
          const file = resolveTokenFile(server, tokenOptions(flags, deps));
          const tokens = new McpDeviceTokenStore(file).get();
          if (flags.json) {
            lines.push({
              server,
              tokenFile: file,
              loggedIn: Boolean(tokens),
              ...(tokens
                ? {
                    expired: isTokenExpired(tokens, now),
                    ...(tokens.expiresAt !== undefined
                      ? { expiresAt: tokens.expiresAt }
                      : {}),
                    ...(tokens.scope ? { scope: tokens.scope } : {}),
                    hasRefreshToken: Boolean(tokens.refreshToken),
                  }
                : {}),
            });
          } else {
            process.stdout.write(`${tokenStateLine(server, tokens, now)}\n`);
          }
        }
        if (flags.json) {
          for (const line of lines) writeJson(line);
        }
        return 0;
      }

      case "list":
      case "ls": {
        const rows = configuredServers(flags, deps);
        const tokenDirResolved = tokenDir ?? defaultTokenDir(deps);
        if (flags.json) {
          writeJson({
            tokenDir: tokenDirResolved,
            servers: rows.map((row) => row.serverName),
          });
          return 0;
        }
        process.stdout.write(`token-dir=${tokenDirResolved}\n`);
        if (rows.length === 0) {
          process.stdout.write("(no configured servers)\n");
          return 0;
        }
        for (const row of rows) {
          process.stdout.write(`${row.serverName}\t${row.url ?? "(stdio)"}\n`);
        }
        return 0;
      }

      case "path": {
        const dir = tokenDir ?? defaultTokenDir(deps);
        process.stdout.write(`${path.resolve(dir)}\n`);
        return 0;
      }

      default:
        throw new Error(
          `unknown mcp subcommand: ${sub} (try: login | logout | status | list | path | help)`,
        );
    }
  } catch (err) {
    process.stderr.write(`error: ${errorMessage(err)}\n`);
    return 1;
  }
}
