/**
 * mcp.workspace domain zod schemas.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './wire.ts'

const serverDraftSchema = z.object({
  serverName: z.string(),
  command: z.string().optional(),
  url: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  cwdAllowWorkspace: z.boolean().optional(),
})

/** mcp.workspace.get request. */
export const mcpWorkspaceGetRequestSchema = z.object({
  workspaceId: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'mcp.workspace.get'>>>

/** mcp.workspace.get response. */
export const mcpWorkspaceGetValueSchema = z.object({
  workspaceId: z.string(),
  path: z.string(),
  servers: z.array(serverDraftSchema),
  denyGlobal: z.array(z.string()),
  fingerprint: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'mcp.workspace.get'>>>

/** mcp.workspace.set request — servers accept Face array or Cursor map. */
export const mcpWorkspaceSetRequestSchema = z.object({
  workspaceId: z.string().min(1),
  servers: z.unknown().optional(),
  denyGlobal: z.array(z.string()).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'mcp.workspace.set'>>>

/** mcp.workspace.set response. */
export const mcpWorkspaceSetValueSchema =
  mcpWorkspaceGetValueSchema satisfies z.ZodType<
    Wire<ResponseValue<'mcp.workspace.set'>>
  >
