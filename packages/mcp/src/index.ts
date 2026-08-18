/**
 * @xrkseek/mcp — MCP client (stdio + streamable-http → ToolRegistry).
 * Default policy: mcp.connect deny. See docs/policy.md.
 */

export {
  createMcpClient,
} from "./client.js";
export {
  registerMcpTools,
  mcpToolDefinition,
  type AppliedMcpTool,
  type RegisterMcpToolsOptions,
  type RegisterMcpToolsResult,
  type SkippedMcpTool,
} from "./register.js";
export {
  SERVER_NAME_PATTERN,
  assertServerName,
  parsePublicToolName,
  publicToolName,
} from "./names.js";
export type {
  McpCallResult,
  McpClient,
  McpClientOptions,
  McpHttpOptions,
  McpHttpReconnectionOptions,
  McpStdioOptions,
  McpToolInfo,
} from "./types.js";
