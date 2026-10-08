/**
 * Browser data client for the Host cron API (`/api/cron/jobs`,
 * `/api/cron/jobs/<id>/logs`, POST pause|resume|remove|run — see docs/cron.md).
 *
 * The scheduler lives in the Host process, so the browser has no mux/RPC
 * channel to it. These endpoints are served by the same loopback gate as the
 * Face WebSocket (`faceCheckAuth`), so a same-origin `fetch` carries the same
 * trust as the existing events.mux connection: no extra credentials needed on
 * the local product page.
 *
 * The client is fetch-injected so the catalog layer stays unit-testable.
 */

/** One Host cron job (mirror of `CronJob` from @xrkseek/server-cron). */
export interface CronJobView {
  readonly id: string
  readonly name?: string
  readonly enabled: boolean
  readonly schedule: CronScheduleView
  readonly run: CronRunView
  readonly delivery: CronDeliveryView
  readonly createdAt: string
  readonly updatedAt: string
  readonly nextRunAt: string | null
  readonly lastRunAt?: string
  readonly lastStatus?: 'ok' | 'error' | 'skipped'
  readonly lastError?: string
  readonly lastOutputChars?: number
}

export type CronScheduleView =
  | { readonly kind: 'every'; readonly everySeconds: number }
  | { readonly kind: 'at'; readonly at: string }
  | { readonly kind: 'cron'; readonly expr: string }

export type CronRunView =
  | {
      readonly kind: 'agent'
      readonly prompt: string
      readonly provider?: string
      readonly model?: string
      readonly workspaceId?: string
    }
  | { readonly kind: 'script'; readonly command: string; readonly cwd?: string }

export type CronDeliveryView =
  | { readonly kind: 'none' }
  | { readonly kind: 'webhook'; readonly url: string; readonly secretEnv?: string }
  | { readonly kind: 'file'; readonly path: string }

/** One bounded execution-ledger row (mirror of `CronExecutionRecord`). */
export interface CronRunRecordView {
  readonly id: string
  readonly jobId: string
  readonly jobName?: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly status: 'ok' | 'error' | 'skipped'
  readonly error?: string
  readonly outputChars: number
  readonly sessionId?: string
}

/** Shape of `GET /api/cron/jobs`. */
export interface CronJobsResponse {
  readonly jobs: readonly CronJobView[]
}

/** Shape of `GET /api/cron/jobs/<id>/logs?limit=`. */
export interface CronJobLogsResponse {
  readonly job: CronJobView
  readonly runs: readonly CronRunRecordView[]
}

/** Shape of POST pause/resume/remove/run (run may be ok:false with HTTP 200). */
export interface CronJobMutationResponse {
  readonly ok: boolean
  readonly job?: CronJobView
  readonly id?: string
  readonly removed?: boolean
  readonly result?: {
    readonly ok: boolean
    readonly output: string
    readonly sessionId?: string
    readonly error?: string
  }
}

export interface CronApiClient {
  /** List all cron jobs. */
  listJobs(signal?: AbortSignal): Promise<CronJobsResponse>
  /** Per-job run history (newest last, bounded by the Host ledger). */
  listRuns(jobId: string, limit?: number, signal?: AbortSignal): Promise<CronJobLogsResponse>
  pause(jobId: string, signal?: AbortSignal): Promise<CronJobMutationResponse>
  resume(jobId: string, signal?: AbortSignal): Promise<CronJobMutationResponse>
  remove(jobId: string, signal?: AbortSignal): Promise<CronJobMutationResponse>
  runNow(jobId: string, signal?: AbortSignal): Promise<CronJobMutationResponse>
}

export class CronApiError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string, message: string) {
    super(message)
    this.status = status
    this.body = body
    this.name = 'CronApiError'
  }
}

/** Browser fetch implementation over the same-origin cron API. */
export function createCronApiClient(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
  base = '',
): CronApiClient {
  const request = async (
    path: string,
    init?: RequestInit,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const response = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { accept: 'application/json', ...(init?.headers ?? {}) },
      ...(signal ? { signal } : {}),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new CronApiError(response.status, text, `cron API ${path} failed with ${response.status}`)
    }
    return JSON.parse(text) as unknown
  }

  const mutate = (jobId: string, action: string, signal?: AbortSignal) =>
    request(
      `/api/cron/jobs/${encodeURIComponent(jobId)}/${action}`,
      { method: 'POST' },
      signal,
    ) as Promise<CronJobMutationResponse>

  return {
    listJobs: async (signal?: AbortSignal) =>
      request('/api/cron/jobs', undefined, signal) as Promise<CronJobsResponse>,
    listRuns: async (jobId: string, limit = 50, signal?: AbortSignal) =>
      request(
        `/api/cron/jobs/${encodeURIComponent(jobId)}/logs?limit=${limit}`,
        undefined,
        signal,
      ) as Promise<CronJobLogsResponse>,
    pause: (jobId, signal) => mutate(jobId, 'pause', signal),
    resume: (jobId, signal) => mutate(jobId, 'resume', signal),
    remove: (jobId, signal) => mutate(jobId, 'remove', signal),
    runNow: (jobId, signal) => mutate(jobId, 'run', signal),
  }
}
