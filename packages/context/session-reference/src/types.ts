/**
 * Public session-reference request, candidate, and preparation records.
 * Face discovery imports stay on type-only subpaths; Cordis prepare lives in
 * `index.ts` (not wired on XRK Host main path).
 * @module @xrkseek/xrk-session-reference/types
 */

import type { ContentBlock, UserMessage } from '@xrkseek/protocol'

/** Opaque session id (Face path; Cordis prepare uses branded ids when wired). */
export type SessionId = string & { readonly __xrkSessionId?: unique symbol }

/** Brand a raw session id string for URI codec helpers. */
export function SessionId(id: string): SessionId {
  return id as SessionId
}

/** Durable source session, cited event seqs, and snapshot facts for prepared cross-session context. */
export interface SessionReferenceSource {
  kind: 'session-reference'
  /** Material lifted out of another session's log (`recall` context form). */
  form: 'recall'
  version: 1
  references: {
    sessionId: string
    label: string
    capturedThroughSeq: number | null
    compacted: boolean
    originalMessages: number
    retainedMessages: number
    omittedMessages: number
    omittedBytes: number
    truncated: boolean
    inputIndex: number
  }[]
}

/** One source session selected by a host. */
export interface SessionReferenceInput {
  /** Opaque source session identity. */
  sessionId: SessionId
  /** Optional user-facing mention label. */
  label?: string
}

/** One host-facing candidate from exact session metadata. */
export interface SessionReferenceCandidate {
  /** Opaque source session identity. */
  sessionId: SessionId
  /** Latest log-backed title, falling back to the opaque session id. */
  label: string
  /** Source session working directory, when recorded. */
  cwd?: string
  /** Source session creation time in Unix epoch milliseconds. */
  createdAt: number
}

/** One discovery candidate carrying its canonical prompt mention. */
export interface SessionReferenceMentionCandidate extends SessionReferenceCandidate {
  /** Canonical `@[label](dsh-session:…)` mention serialized into the prompt draft. */
  mention: string
}

/** Direct message content and optional referenced-session context. */
export interface PreparedReferencedMessage {
  /** Readable message content after host mention tokens are removed. */
  content: ContentBlock[]
  /** Aggregated untrusted snapshot, absent when the message has no references. */
  additionalContext?: UserMessage
}

/** Text-only projected conversation item. */
export interface ReferencedConversationItem {
  /** Original message role. */
  role: 'user' | 'assistant'
  /** Visible text retained from that message. */
  text: string
}
