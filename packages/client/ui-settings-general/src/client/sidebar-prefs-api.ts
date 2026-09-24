/**
 * Sidebar prefs HTTP helpers — `POST /sidebar/api/settings.get|update`
 * (file-backed ~/.xrk/sidebar/prefs.json).
 */

/** Prefs keys this Settings surface owns. */
export type SidebarAgentPushPrefKey = 'agentOpenTools' | 'agentTerminalTools'

/** Snapshot of the two agent-push prefs. */
export interface SidebarAgentPushPrefs {
  readonly agentOpenTools: boolean
  readonly agentTerminalTools: boolean
}

/** Parse `settings.get` / `settings.update` success body into push prefs. */
export function parseSidebarAgentPushPrefs(body: unknown): SidebarAgentPushPrefs | null {
  if (!body || typeof body !== 'object') return null
  const envelope = body as { ok?: unknown; value?: unknown }
  if (envelope.ok !== true || !envelope.value || typeof envelope.value !== 'object') {
    return null
  }
  const row = envelope.value as { value?: unknown }
  if (!row.value || typeof row.value !== 'object') return null
  const prefs = row.value as Record<string, unknown>
  return {
    agentOpenTools: prefs.agentOpenTools === true,
    agentTerminalTools: prefs.agentTerminalTools === true,
  }
}

/** Load agent-push prefs from the Host sidebar prefs doc. */
export async function loadSidebarAgentPushPrefs(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<SidebarAgentPushPrefs | null> {
  try {
    const res = await fetchImpl('/sidebar/api/settings.get', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    if (!res.ok) return null
    return parseSidebarAgentPushPrefs(await res.json())
  } catch {
    return null
  }
}

/** Patch one agent-push pref; returns the new snapshot or null on failure. */
export async function patchSidebarAgentPushPref(
  key: SidebarAgentPushPrefKey,
  value: boolean,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<SidebarAgentPushPrefs | null> {
  try {
    const res = await fetchImpl('/sidebar/api/settings.update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patch: { [key]: value } }),
    })
    if (!res.ok) return null
    return parseSidebarAgentPushPrefs(await res.json())
  } catch {
    return null
  }
}
