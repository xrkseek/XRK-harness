/**
 * tasks domain zod schemas: the branded job id, the wire view carried by
 * `session/jobs` frames, and unary job control RPCs.
 */

import { z } from 'zod'
import type { JobId } from '@xrkseek/xrk-jobs/brand'
import type { JobView } from './jobs.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'

/** JobId: one brand cast after non-empty string validation. */
export const taskIdSchema = z.string().min(1) as unknown as z.ZodType<JobId>

/**
 * One wire task view. `kind` stays an open string because producer plugins
 * extend the registry's kind map by declaration merging, so the closed set is
 * not knowable at this boundary.
 */
export const taskViewSchema = z.object({
  id: taskIdSchema,
  kind: z.string().min(1),
  label: z.string().min(1),
  status: z.union([
    z.literal('running'),
    z.literal('stopping'),
    z.literal('completed'),
    z.literal('killed'),
    z.literal('failed'),
  ]),
  detail: z.string().optional(),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative().optional(),
  foreground: z.boolean().optional(),
}) satisfies z.ZodType<Wire<JobView>>

/** job.kill request payload. */
export const jobKillRequestSchema = z.object({
  sessionId: sessionIdSchema,
  jobId: taskIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'job.kill'>>>

/** job.kill response value. */
export const jobKillValueSchema = z.object({
  outcome: z.union([z.literal('requested'), z.literal('already-finished')]),
}) satisfies z.ZodType<Wire<ResponseValue<'job.kill'>>>

/** job.background request payload. */
export const jobBackgroundRequestSchema = z.object({
  sessionId: sessionIdSchema,
  jobId: taskIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'job.background'>>>

/** job.background response value. */
export const jobBackgroundValueSchema = z.object({
  accepted: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'job.background'>>>
