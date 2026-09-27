/**
 * Data client: the fetch-injected cron read API client (docs/cron.md).
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { CronApiError, createCronApiClient } from '../src/client/cron-api.ts'

function jsonResponse(body: unknown, status = 200): Response {
  const text = JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  } as unknown as Response
}

const JOB = {
  id: 'job-1',
  name: 'nightly digest',
  enabled: true,
  schedule: { kind: 'cron', expr: '0 3 * * *' },
  run: { kind: 'agent', prompt: 'summarize' },
  delivery: { kind: 'none' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  nextRunAt: '2026-01-02T03:00:00.000Z',
}

describe('cron read API client', () => {
  it('lists jobs over the same-origin read endpoint', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [JOB] }))
    const client = createCronApiClient(fetchImpl as unknown as typeof fetch)

    const response = await client.listJobs()
    expect(response.jobs).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/cron/jobs',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
  })

  it('reads per-job run history with the bounded limit and encoded id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      job: JOB,
      runs: [{
        id: 'run-1',
        jobId: 'job-1',
        startedAt: '2026-01-02T03:00:00.000Z',
        finishedAt: '2026-01-02T03:00:05.000Z',
        status: 'ok',
        outputChars: 42,
      }],
    }))
    const client = createCronApiClient(fetchImpl as unknown as typeof fetch)

    const response = await client.listRuns('job/1', 25)
    expect(response.runs[0]?.outputChars).toBe(42)
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/cron/jobs/job%2F1/logs?limit=25',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
  })

  it('defaults the run-history limit to 50', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ job: JOB, runs: [] }))
    const client = createCronApiClient(fetchImpl as unknown as typeof fetch)
    await client.listRuns('job-1')
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/cron/jobs/job-1/logs?limit=50')
  })

  it('passes the abort signal only when one is supplied', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [] }))
    const client = createCronApiClient(fetchImpl as unknown as typeof fetch)

    await client.listJobs()
    expect(Object.keys(fetchImpl.mock.calls[0]?.[1] as object)).toEqual(['headers'])

    const controller = new AbortController()
    await client.listJobs(controller.signal)
    expect((fetchImpl.mock.calls[1]?.[1] as { signal?: AbortSignal }).signal)
      .toBe(controller.signal)
  })

  it('surfaces a Host error as CronApiError with status and body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(
      { error: 'cron scheduler is not running (XRK_CRON=0 or disabled)' },
      503,
    ))
    const client = createCronApiClient(fetchImpl as unknown as typeof fetch)

    await expect(client.listJobs()).rejects.toBeInstanceOf(CronApiError)
    await expect(client.listJobs()).rejects.toMatchObject({
      status: 503,
      body: '{"error":"cron scheduler is not running (XRK_CRON=0 or disabled)"}',
    })
  })

  it('honors a configured base path', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ jobs: [] }))
    const client = createCronApiClient(fetchImpl as unknown as typeof fetch, 'http://host:8787')
    await client.listJobs()
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://host:8787/api/cron/jobs')
  })
})
