/**
 * mcp.oauth domain zod schemas (names derived from map keys).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { McpOauthStatusItem } from './mcp-oauth.ts'

/** MCP server name (matches `@xrkseek/mcp` assertServerName). */
export const mcpOauthServerNameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/)

const loginPhaseSchema = z.enum(['idle', 'pending', 'logged-in', 'error', 'cancelled'])

/** One status row. */
export const mcpOauthStatusItemSchema = z.object({
  server: z.string(),
  tokenFile: z.string(),
  loggedIn: z.boolean(),
  expired: z.boolean().optional(),
  expiresAt: z.number().optional(),
  scope: z.string().optional(),
  hasRefreshToken: z.boolean().optional(),
  loginPhase: loginPhaseSchema,
  userCode: z.string().optional(),
  verificationUri: z.string().optional(),
  verificationUriComplete: z.string().optional(),
  loginError: z.string().optional(),
}) satisfies z.ZodType<Wire<McpOauthStatusItem>>

/** mcp.oauth.status request. */
export const mcpOauthStatusRequestSchema = z.object({
  servers: z.array(mcpOauthServerNameSchema).max(64).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'mcp.oauth.status'>>>

/** mcp.oauth.status response. */
export const mcpOauthStatusValueSchema = z.object({
  tokenDir: z.string(),
  items: z.array(mcpOauthStatusItemSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'mcp.oauth.status'>>>

/** mcp.oauth.login request. */
export const mcpOauthLoginRequestSchema = z.object({
  server: mcpOauthServerNameSchema,
  url: z.string().optional(),
  clientId: z.string().optional(),
  deviceAuthorizationUrl: z.string().optional(),
  tokenUrl: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  audience: z.string().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'mcp.oauth.login'>>>

/** mcp.oauth.login response. */
export const mcpOauthLoginValueSchema = z.object({
  server: z.string(),
  status: z.enum(['pending', 'logged-in']),
  userCode: z.string().optional(),
  verificationUri: z.string().optional(),
  verificationUriComplete: z.string().optional(),
  expiresInSeconds: z.number().optional(),
  tokenFile: z.string().optional(),
}) satisfies z.ZodType<Wire<ResponseValue<'mcp.oauth.login'>>>

/** mcp.oauth.logout request. */
export const mcpOauthLogoutRequestSchema = z.object({
  server: mcpOauthServerNameSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'mcp.oauth.logout'>>>

/** mcp.oauth.logout response. */
export const mcpOauthLogoutValueSchema = z.object({
  server: z.string(),
  status: z.enum(['logged-out', 'absent']),
}) satisfies z.ZodType<Wire<ResponseValue<'mcp.oauth.logout'>>>
