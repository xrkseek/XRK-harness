/**
 * Human peek of background-job output via Host sidebar bridge.
 * Same contract as ui-jobs `peekJobOutput` (no cross-plugin import).
 */

export type JobOutputPeek = {
  readonly text: string
  readonly truncated: boolean
}

/** POST `/sidebar/api/jobs.output` → retained / mid-run text. */
export async function peekJobOutput(
  jobId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JobOutputPeek> {
  const response = await fetchImpl('/sidebar/api/jobs.output', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId }),
  })
  if (!response.ok) {
    throw new Error(`jobs.output: HTTP ${response.status}`)
  }
  const body = await response.json() as {
    ok?: boolean
    value?: { text?: unknown; truncated?: unknown }
    text?: unknown
    truncated?: unknown
    error?: { message?: string }
  }
  if (body.ok === false) {
    throw new Error(body.error?.message ?? 'jobs.output failed')
  }
  const value = body.value && typeof body.value === 'object' ? body.value : body
  const text = typeof value.text === 'string' ? value.text : ''
  const truncated = value.truncated === true
  return { text, truncated }
}
