/**
 * mcp.workspace domain: project `{cwd}/.xrk/mcp.json` get/set for Settings + AI.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One desired server row in a workspace MCP overlay. */
export interface McpWorkspaceServerDraft {
  readonly serverName: string
  readonly command?: string
  readonly url?: string
  readonly args?: readonly string[]
  readonly cwd?: string
  readonly cwdAllowWorkspace?: boolean
}

/** mcp.workspace unary methods. */
export interface McpWorkspaceApi {
  /** Read `{workspace}/.xrk/mcp.json` for a project workspace id. */
  get(request: RpcRequest<{
    workspaceId: string
  }>): Promise<RpcResponse<{
    workspaceId: string
    path: string
    servers: McpWorkspaceServerDraft[]
    denyGlobal: string[]
    fingerprint: string
  }>>

  /** Write `{workspace}/.xrk/mcp.json` (servers + denyGlobal). */
  set(request: RpcRequest<{
    workspaceId: string
    servers?: McpWorkspaceServerDraft[] | Record<string, unknown> | { mcpServers: unknown }
    denyGlobal?: string[]
  }>): Promise<RpcResponse<{
    workspaceId: string
    path: string
    servers: McpWorkspaceServerDraft[]
    denyGlobal: string[]
    fingerprint: string
  }>>
}
