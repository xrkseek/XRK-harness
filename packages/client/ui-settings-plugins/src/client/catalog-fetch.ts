/**
 * Face unary helpers for Plugins catalog tabs (tools + skills).
 * Ride connection IApiClient: session.tools · skill.list · skill.read.
 */

import type {
  InjectDocumentEntry,
  SessionId,
  SessionToolsValue,
  SkillEntry,
  SkillListValue,
  SkillReadValue,
} from '@xrkseek/client-connection/client'

export type {
  InjectDocumentEntry,
  SessionToolsValue,
  SkillEntry,
  SkillListValue,
  SkillReadValue,
}

type UnaryResult<T> = {
  result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
}

function unwrap<T>(label: string, response: UnaryResult<T>): T {
  const { result } = response
  if (!result.ok) throw new Error(`${label} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}

/** List tools for a session via connection `session.tools`. */
export async function fetchSessionTools(
  tools: (req: { sessionId: SessionId }, signal?: AbortSignal) => Promise<UnaryResult<SessionToolsValue>>,
  sessionId: SessionId,
  signal?: AbortSignal,
): Promise<SessionToolsValue> {
  return unwrap('session.tools', await tools({ sessionId }, signal))
}

/** List skills + inject documents via connection `skill.list`. */
export async function fetchSessionSkills(
  list: (req: { sessionId: SessionId }, signal?: AbortSignal) => Promise<UnaryResult<SkillListValue>>,
  sessionId: SessionId,
  signal?: AbortSignal,
): Promise<SkillListValue> {
  return unwrap('skill.list', await list({ sessionId }, signal))
}

/** Read one skill body or inject document via connection `skill.read`. */
export async function fetchSkillContent(
  read: (
    req: { sessionId: SessionId; name?: string; document?: string },
    signal?: AbortSignal,
  ) => Promise<UnaryResult<SkillReadValue>>,
  sessionId: SessionId,
  selector: { name: string } | { document: string },
  signal?: AbortSignal,
): Promise<SkillReadValue> {
  return unwrap('skill.read', await read({ sessionId, ...selector }, signal))
}
