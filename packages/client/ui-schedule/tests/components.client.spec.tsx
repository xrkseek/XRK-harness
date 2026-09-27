/**
 * Pure projections + component rendering for the schedule directory tab.
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CronApiClient } from '../src/client/cron-api.ts'
import {
  ScheduleSettingsTab,
  type ScheduleSettingsTabProps,
} from '../src/client/ScheduleSettingsTab.tsx'
import { en, type ScheduleLocaleKey } from '../src/client/locales.ts'
import {
  deliveryLabel,
  jobDisplayName,
  lastStatusLabel,
  runLabel,
  runStatusLabel,
  scheduleLabel,
} from '../src/client/schedule-view.ts'

afterEach(cleanup)

const t = ((key: ScheduleLocaleKey, params?: Record<string, string | number>): string => {
  const template = en[key]
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}) as ScheduleSettingsTabProps['t']

const JOB = {
  id: 'job-1',
  name: 'nightly digest',
  enabled: true,
  schedule: { kind: 'cron', expr: '0 3 * * *' },
  run: { kind: 'agent', prompt: 'summarize the day' },
  delivery: { kind: 'none' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  nextRunAt: '2026-01-02T03:00:00.000Z',
  lastStatus: 'ok',
  lastRunAt: '2026-01-01T03:00:00.000Z',
}

const RUN = {
  id: 'run-1',
  jobId: 'job-1',
  startedAt: '2026-01-01T03:00:00.000Z',
  finishedAt: '2026-01-01T03:00:05.000Z',
  status: 'ok',
  outputChars: 128,
}

function props(api: CronApiClient): ScheduleSettingsTabProps {
  return { t, api } as ScheduleSettingsTabProps
}

describe('schedule-view projections', () => {
  it('renders every / at / cron schedules', () => {
    expect(scheduleLabel({ kind: 'every', everySeconds: 300 }, t)).toBe('Every 300s')
    expect(scheduleLabel({ kind: 'at', at: '2026-02-01T00:00:00.000Z' }, t)).toBe(
      '2026-02-01T00:00:00.000Z one-shot',
    )
    expect(scheduleLabel({ kind: 'cron', expr: '0 3 * * *' }, t)).toBe('cron 0 3 * * *')
  })

  it('renders agent and script runs', () => {
    expect(runLabel({ kind: 'agent', prompt: 'hi' }, t)).toBe('Agent: hi')
    expect(runLabel({ kind: 'script', command: 'npm test', cwd: '/w' }, t)).toBe('Script: npm test')
  })

  it('renders delivery kinds and last-run status', () => {
    expect(deliveryLabel({ kind: 'none' }, t)).toBe('No delivery')
    expect(deliveryLabel({ kind: 'webhook', url: 'https://h' }, t)).toBe('Webhook')
    expect(deliveryLabel({ kind: 'file', path: 'out.jsonl' }, t)).toBe('File')

    expect(lastStatusLabel({ ...JOB, lastStatus: undefined }, t)).toBe('Never run')
    expect(lastStatusLabel({ ...JOB, lastStatus: 'ok' }, t)).toBe('Last run OK')
    expect(lastStatusLabel({ ...JOB, lastStatus: 'error' }, t)).toBe('Last run failed')
    expect(lastStatusLabel({ ...JOB, lastStatus: 'skipped' }, t)).toBe('Last run skipped')
  })

  it('renders run status and falls back to the anonymous name', () => {
    expect(runStatusLabel({ ...RUN, status: 'ok' }, t)).toBe('OK')
    expect(runStatusLabel({ ...RUN, status: 'error' }, t)).toBe('Failed')
    expect(runStatusLabel({ ...RUN, status: 'skipped' }, t)).toBe('Skipped')
    expect(jobDisplayName({ ...JOB, name: undefined }, t)).toBe('（unnamed job）')
  })
})

describe('ScheduleSettingsTab', () => {
  it('shows loading then the task directory', async () => {
    const api = {
      listJobs: vi.fn(async () => ({ jobs: [JOB] })),
      listRuns: vi.fn(async () => ({ job: JOB, runs: [] })),
    } as unknown as CronApiClient
    const view = render(<ScheduleSettingsTab {...props(api)} />)

    expect(screen.getByText(en.loading)).toBeTruthy()
    await waitFor(() => expect(screen.getByText('nightly digest')).toBeTruthy())
    expect(api.listJobs).toHaveBeenCalledOnce()
    expect(view.container.querySelector('[data-job-count]')?.textContent).toBe('1')
  })

  it('shows the retry surface on a failed catalog read', async () => {
    const api = {
      listJobs: vi.fn(async () => { throw new Error('network down') }),
      listRuns: vi.fn(),
    } as unknown as CronApiClient
    render(<ScheduleSettingsTab {...props(api)} />)

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText(en.error)).toBeTruthy()
    expect(screen.getByText(en.errorHint)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.retry })).toBeTruthy()
  })

  it('shows the retry surface when the body lacks a jobs array', async () => {
    const api = {
      listJobs: vi.fn(async () => ({
        ok: true,
        adapter: 'xrk-dsh-compat',
      })),
      listRuns: vi.fn(),
    } as unknown as CronApiClient
    render(<ScheduleSettingsTab {...props(api)} />)

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText(en.error)).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('loads run history only when a job is expanded', async () => {
    const api = {
      listJobs: vi.fn(async () => ({ jobs: [JOB] })),
      listRuns: vi.fn(async () => ({ job: JOB, runs: [{ ...RUN, status: 'error', error: 'boom' }] })),
    } as unknown as CronApiClient
    const view = render(<ScheduleSettingsTab {...props(api)} />)

    await waitFor(() => expect(screen.getByText('nightly digest')).toBeTruthy())
    expect(api.listRuns).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /nightly digest/ }))
    await waitFor(() => expect(api.listRuns).toHaveBeenCalledWith('job-1', 50, expect.any(AbortSignal)))
    expect(screen.getByText(en.runsTitle)).toBeTruthy()
    expect(screen.getByText(en.runStatusError)).toBeTruthy()
    expect(screen.getByText('boom')).toBeTruthy()
    expect(view.container.querySelector('[data-status="error"]')).toBeTruthy()
  })

  it('closes the expanded job when the catalog reloads without it', async () => {
    const api = {
      listJobs: vi.fn(async () => ({ jobs: [JOB] })),
      listRuns: vi.fn(async () => ({ job: JOB, runs: [] })),
    } as unknown as CronApiClient
    render(<ScheduleSettingsTab {...props(api)} />)

    await waitFor(() => expect(screen.getByText('nightly digest')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /nightly digest/ }))
    await waitFor(() => expect(screen.getByText(en.runsTitle)).toBeTruthy())

    api.listJobs.mockResolvedValueOnce({ jobs: [] })
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await waitFor(() => expect(screen.queryByText(en.runsTitle)).toBeNull())
  })
})
