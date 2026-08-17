/**
 * @xrkseek/mcp — MCP client M0 (stdio → ToolRegistry).
 * Default policy: mcp.connect deny. See docs/policy.md.
 */

export {
  createMcpClient,
} from "./client.js";
export {
  registerMcpTools,
  type AppliedMcpTool,
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
  McpStdioOptions,
  McpToolInfo,
} from "./types.js";
