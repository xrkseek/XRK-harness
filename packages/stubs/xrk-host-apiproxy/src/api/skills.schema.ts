/**
 * skills domain zod schemas (names derived from map keys: skillListRequestSchema /
 * skillListValueSchema / skillRead*).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { SkillEntry, SkillListValue, SkillReadValue } from './skills.ts'

const skillListSourceSchema = z.object({
  layer: z.enum(['workspace', 'home', 'other']),
  vendor: z.enum(['xrk', 'agents', 'cursor', 'claude', 'codex', 'other']),
  root: z.string().min(1),
})

/** SkillEntry row of skill.list. */
export const skillEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  whenToUse: z.string().optional(),
  modelInvocable: z.boolean(),
  source: skillListSourceSchema.optional(),
}) satisfies z.ZodType<Wire<SkillEntry>>

const injectDocumentEntrySchema = z.object({
  path: z.string().min(1),
  layer: z.enum(['workspace', 'home']),
  kind: z.enum(['instruction', 'skill-catalog']),
  bytes: z.number().int().nonnegative(),
})

/** skill.list request payload. */
export const skillListRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'skill.list'>>>

/** skill.list response value. */
export const skillListValueSchema = z.object({
  skills: z.array(skillEntrySchema),
  workspace: z.object({
    cwd: z.string().min(1),
    label: z.string().min(1),
  }),
  documents: z.array(injectDocumentEntrySchema),
}) satisfies z.ZodType<Wire<SkillListValue>>

/** skill.read request payload. */
export const skillReadRequestSchema = z.object({
  sessionId: sessionIdSchema,
  name: z.string().min(1).optional(),
  document: z.string().min(1).optional(),
}).refine(
  (p) => (p.name !== undefined ? 1 : 0) + (p.document !== undefined ? 1 : 0) === 1,
  { message: 'exactly one of name or document required' },
) satisfies z.ZodType<Wire<RequestPayload<'skill.read'>>>

/** skill.read response value. */
export const skillReadValueSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('skill'),
    name: z.string().min(1),
    description: z.string(),
    content: z.string(),
    source: skillListSourceSchema,
  }),
  z.object({
    kind: z.literal('document'),
    path: z.string().min(1),
    content: z.string(),
  }),
]) satisfies z.ZodType<Wire<SkillReadValue>>
