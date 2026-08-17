/** Public MCP tool names: `mcp__<serverName>__<rawName>`. */

export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export function assertServerName(serverName: string): void {
  if (!SERVER_NAME_PATTERN.test(serverName)) {
    throw new Error(
      `invalid MCP serverName "${serverName}": must match [A-Za-z0-9_-]{1,32}`,
    );
  }
}

export function publicToolName(serverName: string, rawName: string): string {
  assertServerName(serverName);
  if (!rawName || rawName.includes("__")) {
    throw new Error(`invalid MCP raw tool name: ${JSON.stringify(rawName)}`);
  }
  return `mcp__${serverName}__${rawName}`;
}

export function parsePublicToolName(
  publicName: string,
): { serverName: string; rawName: string } | undefined {
  const m = /^mcp__([A-Za-z0-9_-]{1,32})__(.+)$/.exec(publicName);
  if (!m) return undefined;
  const serverName = m[1]!;
  const rawName = m[2]!;
  if (!rawName || rawName.includes("__")) return undefined;
  return { serverName, rawName };
}
