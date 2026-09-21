/**
 * Read existing preview endpoints. No new RPC shapes:
 * POST /sidebar/api/plan.preview → { ok, value: { active, pending } }
 * POST /office/connection.status → { result: { ok, value: { configured, connected } } }
 */

export interface PlanPreviewView {
  readonly active: boolean
  readonly pending: boolean
}

export interface OfficePreviewView {
  readonly configured: boolean
  readonly connected: boolean
}

export interface PreviewTabLoad {
  readonly plan: PlanPreviewView | null
  readonly office: OfficePreviewView | null
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** Plan summary from the sidebar RPC envelope. Null when the body is not that shape. */
export function parsePlanPreview(body: unknown): PlanPreviewView | null {
  if (!body || typeof body !== 'object') return null
  const envelope = body as { ok?: unknown; value?: unknown }
  if (envelope.ok !== true || !envelope.value || typeof envelope.value !== 'object') return null
  const value = envelope.value as { active?: unknown; pending?: unknown }
  const active = bool(value.active)
  const pending = bool(value.pending)
  if (active === undefined || pending === undefined) return null
  return { active, pending }
}

/** Office status from the dsh-compat RPC envelope. Null when the body is not that shape. */
export function parseOfficePreview(body: unknown): OfficePreviewView | null {
  if (!body || typeof body !== 'object') return null
  const envelope = body as { result?: unknown }
  if (!envelope.result || typeof envelope.result !== 'object') return null
  const result = envelope.result as { ok?: unknown; value?: unknown }
  if (result.ok !== true || !result.value || typeof result.value !== 'object') return null
  const value = result.value as { configured?: unknown; connected?: unknown }
  const configured = bool(value.configured)
  const connected = bool(value.connected)
  if (configured === undefined || connected === undefined) return null
  return { configured, connected }
}

/** Fetch both previews. A failed request becomes null; the other tab still renders. */
export async function loadPreviewTabs(
  sessionId: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<PreviewTabLoad> {
  const [planBody, officeBody] = await Promise.all([
    fetchImpl('/sidebar/api/plan.preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).then(async (res) => res.json() as Promise<unknown>).catch(() => null),
    fetchImpl('/office/connection.status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'preview-tabs',
        method: 'connection.status',
        payload: {},
      }),
    }).then(async (res) => res.json() as Promise<unknown>).catch(() => null),
  ])
  return {
    plan: parsePlanPreview(planBody),
    office: parseOfficePreview(officeBody),
  }
}
