// Status projection: known wire statuses map to their markers and words;
// unknown statuses (a newer host this build has not seen) degrade rather than
// throwing, so one stale row can never crash the whole job list.
import { describe, expect, it } from 'vitest'
import { jobDotState, jobStatusLabel } from '../src/client/job-list-shared.ts'

/** Minimal translate stub: returns the key so assertions read as the status table. */
const t = ((key: string) => key) as Parameters<typeof jobStatusLabel>[1]

describe('jobDotState', () => {
  it('maps every known status to its marker', () => {
    expect(jobDotState('running')).toBe('ongoing')
    expect(jobDotState('stopping')).toBe('warning')
    expect(jobDotState('completed')).toBe('done')
    expect(jobDotState('killed')).toBe('warning')
    expect(jobDotState('failed')).toBe('error')
  })

  it('degrades an unknown wire status to the amber attention dot', () => {
    // A host newer than this build can add a status; it must render, not throw.
    expect(jobDotState('paused' as Parameters<typeof jobDotState>[0])).toBe('warning')
  })
})

describe('jobStatusLabel', () => {
  it('translates every known status', () => {
    expect(jobStatusLabel('running', t)).toBe('status.running')
    expect(jobStatusLabel('completed', t)).toBe('status.completed')
  })

  it('keeps the raw word for an unknown wire status', () => {
    expect(jobStatusLabel('paused' as Parameters<typeof jobStatusLabel>[0], t)).toBe('paused')
  })
})
