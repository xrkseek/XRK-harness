/**
 * Shared MCP server list parsing: Face array, Cursor `{ mcpServers }`, or
 * bare name→spec map. Env maps are accepted here; Face persist drops them.
 */

export type McpServerRow = {
  readonly serverName: string;
  readonly command?: string;
  readonly url?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
};

/** Cursor/Claude object map, or a bare `{ name: { command } }` map. */
export function mcpServersObjectMap(
  raw: unknown,
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const nested = o.mcpServers;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  const keys = Object.keys(o);
  if (keys.length === 0) return undefined;
  const first = o[keys[0]!];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const row = first as Record<string, unknown>;
    if ("command" in row || "url" in row || "args" in row) return o;
  }
  return undefined;
}

function rowFromNamed(
  serverName: string,
  row: unknown,
  options?: { readonly keepEnv?: boolean },
): McpServerRow | undefined {
  const name = serverName.trim();
  if (!name || !row || typeof row !== "object" || Array.isArray(row)) {
    return undefined;
  }
  const o = row as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url.trim() : "";
  const command = typeof o.command === "string" ? o.command.trim() : "";
  if (!url && !command) return undefined;
  return {
    serverName: name,
    ...(url ? { url } : { command }),
    ...(Array.isArray(o.args) ? { args: o.args.map((a) => String(a)) } : {}),
    ...(options?.keepEnv === true
      && o.env
      && typeof o.env === "object"
      && !Array.isArray(o.env)
      ? {
          env: Object.fromEntries(
            Object.entries(o.env as Record<string, unknown>).map(([k, v]) => [
              k,
              String(v),
            ]),
          ),
        }
      : {}),
    ...(typeof o.cwd === "string" && o.cwd.trim() ? { cwd: o.cwd.trim() } : {}),
  };
}

/**
 * Parse MCP desired servers from JSON value.
 * @param raw - array, `{ mcpServers: {…} }`, or bare name map.
 * @param options.throwOnInvalid - when true, bad shapes throw (env/Face mutate).
 * @param options.keepEnv - when true, keep `env` maps (Host env wiring only).
 */
export function parseMcpServersValue(
  raw: unknown,
  options?: {
    readonly throwOnInvalid?: boolean;
    readonly keepEnv?: boolean;
  },
): McpServerRow[] {
  if (raw === undefined) return [];
  const throwOn = options?.throwOnInvalid === true;
  const keepEnv = options?.keepEnv === true;
  const out: McpServerRow[] = [];

  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        if (throwOn) throw new Error("mcp.servers entries must be objects");
        continue;
      }
      const o = row as Record<string, unknown>;
      const mapped = rowFromNamed(String(o.serverName ?? ""), o, { keepEnv });
      if (!mapped) {
        if (throwOn) {
          throw new Error("mcp.servers entry needs serverName and command or url");
        }
        continue;
      }
      out.push(mapped);
    }
    return out;
  }

  const map = mcpServersObjectMap(raw);
  if (!map) {
    if (throwOn) {
      throw new Error(
        "mcp.servers must be an array or { mcpServers: { name: { command } } }",
      );
    }
    return [];
  }
  for (const [name, row] of Object.entries(map)) {
    const mapped = rowFromNamed(name, row, { keepEnv });
    if (!mapped) {
      if (throwOn) throw new Error("mcp.servers entry needs command or url");
      continue;
    }
    out.push(mapped);
  }
  return out;
}

/** Parse `XRK_MCP_SERVERS` JSON string (array or Cursor object). */
export function parseMcpServersJson(raw: string): McpServerRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("XRK_MCP_SERVERS must be valid JSON");
  }
  return parseMcpServersValue(parsed, { throwOnInvalid: true, keepEnv: true });
}

/** True when any row carries an `env` map (Face rejects persist). */
export function mcpServersContainEnv(raw: unknown): boolean {
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : Object.values(mcpServersObjectMap(raw) ?? {});
  return rows.some(
    (row) =>
      row !== null
      && typeof row === "object"
      && !Array.isArray(row)
      && (row as { env?: unknown }).env !== undefined,
  );
}
