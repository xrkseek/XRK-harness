/**
 * skills domain contract: read-only skill catalog lookup addressed by session.
 * The session's header cwd resolves to the canonical project root host-side —
 * the client never submits a raw path, and skill lookup never creates or
 * resumes an Agent.
 */

import type { SessionId } from '@xrkseek/xrk-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Standing catalog layer for a skill row (Face `skill.list`). */
export type SkillListLayer = 'workspace' | 'home' | 'other'

/** Vendor tree under a skill root. */
export type SkillListVendor =
  | 'xrk'
  | 'agents'
  | 'cursor'
  | 'claude'
  | 'codex'
  | 'other'

/** Wire-safe origin for one skill (no absolute paths). */
export interface SkillListSource {
  readonly layer: SkillListLayer
  readonly vendor: SkillListVendor
  /** Relative root label, e.g. `.xrk/skills` or `~/.claude/skills`. */
  readonly root: string
}

/** Skill catalog row (wire projection of the host SkillSummary; provider/source vocabulary stays host-side). */
export interface SkillEntry {
  /** Kebab-case identifier the user references as `/name` in the composer. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** False marks a user-only skill (`disable-model-invocation`): invocable here, absent from the model catalog. */
  readonly modelInvocable: boolean
  /** Origin group for Settings catalogs (optional on older hosts). */
  readonly source?: SkillListSource
}

/** Inject document layer on `skill.list`. */
export type InjectDocumentLayer = 'workspace' | 'home'

/** Kind of standing inject payload. */
export type InjectDocumentKind = 'instruction' | 'skill-catalog'

/** Standing inject document Host actually puts on the prompt. */
export interface InjectDocumentEntry {
  readonly path: string
  readonly layer: InjectDocumentLayer
  readonly kind: InjectDocumentKind
  readonly bytes: number
}

/** Session cwd label on `skill.list`. */
export interface SkillListWorkspace {
  readonly cwd: string
  readonly label: string
}

/** `skill.list` response value. */
export interface SkillListValue {
  readonly skills: readonly SkillEntry[]
  readonly workspace: SkillListWorkspace
  readonly documents: readonly InjectDocumentEntry[]
}

/** `skill.read` response for a skill body. */
export interface SkillReadSkillValue {
  readonly kind: 'skill'
  readonly name: string
  readonly description: string
  readonly content: string
  readonly source: SkillListSource
}

/** `skill.read` response for an inject document. */
export interface SkillReadDocumentValue {
  readonly kind: 'document'
  readonly path: string
  readonly content: string
}

export type SkillReadValue = SkillReadSkillValue | SkillReadDocumentValue

/**
 * Skill-domain unary methods (the map key skill.* of RpcMethodMap).
 * Invocation itself remains a plain `session.prompt` with a leading `/name`
 * token; `read` is Settings / catalog preview only.
 */
export interface SkillsApi {
  /** Lists the user-invocable skill catalog + inject documents for the session cwd. */
  list(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<SkillListValue>>

  /**
   * Read one skill (`name`) or inject document (`document` logical path).
   * Exactly one of the two selectors is required.
   */
  read(request: RpcRequest<{
    sessionId: SessionId
    name?: string
    document?: string
  }>): Promise<RpcResponse<SkillReadValue>>
}
