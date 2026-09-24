/**
 * mcp.oauth domain: Settings MCP card device-code login / status / logout.
 * Same token layout as `xrkh mcp login|status|logout` (`~/.xrk/mcp-tokens`).
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Wire view of one server's OAuth token + in-flight login (no secrets). */
export interface McpOauthStatusItem {
  readonly server: string
  readonly tokenFile: string
  readonly loggedIn: boolean
  readonly expired?: boolean
  readonly expiresAt?: number
  readonly scope?: string
  readonly hasRefreshToken?: boolean
  readonly loginPhase: 'idle' | 'pending' | 'logged-in' | 'error' | 'cancelled'
  readonly userCode?: string
  readonly verificationUri?: string
  readonly verificationUriComplete?: string
  readonly loginError?: string
}

/** mcp.oauth unary methods (map keys mcp.oauth.* of RpcMethodMap). */
export interface McpOauthApi {
  /** Per-server token status (+ pending device-code prompt when login is in flight). */
  status(request: RpcRequest<{
    servers?: string[]
  }>): Promise<RpcResponse<{
    tokenDir: string
    items: McpOauthStatusItem[]
  }>>

  /**
   * Start device-code login. Returns `pending` with the user code as soon as
   * the authorization server issues it; Host keeps polling until tokens land.
   */
  login(request: RpcRequest<{
    server: string
    url?: string
    clientId?: string
    deviceAuthorizationUrl?: string
    tokenUrl?: string
    scopes?: string[]
    audience?: string
  }>): Promise<RpcResponse<{
    server: string
    status: 'pending' | 'logged-in'
    userCode?: string
    verificationUri?: string
    verificationUriComplete?: string
    expiresInSeconds?: number
    tokenFile?: string
  }>>

  /** Delete the on-disk token and cancel an in-flight login. */
  logout(request: RpcRequest<{
    server: string
  }>): Promise<RpcResponse<{
    server: string
    status: 'logged-out' | 'absent'
  }>>
}
