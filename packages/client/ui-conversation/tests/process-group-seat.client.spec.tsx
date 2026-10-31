// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ProcessGroupSeat } from '../src/client/chat/ProcessGroupSeat.tsx'
import type { ProcessFoldWhen } from '../src/client/conversation-nodes/presentation-policy.ts'
import type { FlowEntry } from '../src/client/conversation-nodes/process-groups.ts'

afterEach(cleanup)

/** Keys plus their params: quiet-mode title tests need the count to survive. */
const t = ((key: string, params?: Record<string, unknown>) =>
  (params === undefined ? key : `${key}:${JSON.stringify(params)}`)) as never

/** ChatNodeSeat reads its node through this seat; an empty store renders no
 *  member content, which is all this test needs — the group chrome is what is
 *  under test. */
const useSession = ((selector: (state: unknown) => unknown) => selector({
  chat: { nodes: new Map<string, unknown>() },
})) as never

const seat = { useSession } as never

function group(closed: boolean, overrides: Partial<Extract<FlowEntry, { kind: 'group' }>['summary']> = {}): FlowEntry & { kind: 'group' } {
  return {
    kind: 'group',
    key: 'process:a1',
    turn: 1,
    closed,
    summary: {
      tools: 2,
      reasoning: 1,
      toolNames: ['bash', 'Read'],
      toolCallNames: ['bash', 'Read'],
      runningTool: undefined,
      running: false,
      ...overrides,
    },
    members: [{ key: 'a1' }, { key: 'a2' }, { key: 'a3' }],
  }
}

/** Whole-row toggle target (`expandOnRowClick`); falls back to the leading button. */
const toggle = (container: HTMLElement): HTMLElement | null =>
  container.querySelector('[data-disclosure-row]')
  ?? container.querySelector('[data-process-group] button')

const body = (container: HTMLElement): HTMLElement | null =>
  container.querySelector('[data-process-group-body]')

const summary = (container: HTMLElement): HTMLElement | null =>
  container.querySelector('[data-process-summary]')

/** jsdom reports a zero rect for everything, so fold geometry is staged. */
function rectOf(top: number, bottom: number): DOMRect {
  return {
    top, bottom, height: bottom - top, left: 0, right: 0, width: 0, y: top,
    toJSON: () => ({}),
  } as DOMRect
}

/** Render the seat with the standard-mode defaults, overriding what a case needs. */
function renderSeat(
  entry: FlowEntry & { kind: 'group' },
  overrides: Partial<{
    foldWhen: ProcessFoldWhen
    idleSettled: boolean
    detailTitles: boolean
    liveProcessDetail: boolean
    writeScroll: (scrollport: HTMLElement, top: number) => void
    onFoldSettled: () => void
  }> = {},
) {
  const props = {
    foldWhen: 'process' as ProcessFoldWhen,
    idleSettled: false,
    detailTitles: true,
    liveProcessDetail: true,
    ...overrides,
  }
  return render(<ProcessGroupSeat entry={entry} nodeSeat={seat} t={t} {...props} />)
}

/** A group inside a measured scrollport, with the group's lower edge staged. */
function stageFold(
  entry: FlowEntry & { kind: 'group' },
  writeScroll: (scrollport: HTMLElement, top: number) => void,
) {
  const view = render(
    <div data-conversation-scroll>
      <ProcessGroupSeat
        entry={entry}
        nodeSeat={seat}
        t={t}
        foldWhen="process"
        detailTitles
        liveProcessDetail
        writeScroll={writeScroll}
      />
    </div>,
  )
  const scrollport = view.container.querySelector<HTMLElement>('[data-conversation-scroll]')!
  const root = view.container.querySelector<HTMLElement>('[data-process-group]')!
  Object.defineProperty(scrollport, 'scrollHeight', { value: 1200, configurable: true })
  Object.defineProperty(scrollport, 'clientHeight', { value: 600, configurable: true })
  scrollport.scrollTop = 400
  scrollport.getBoundingClientRect = () => rectOf(0, 600)
  return { view, scrollport, root }
}

describe('ProcessGroupSeat', () => {
  it('keeps an open Turn flat while a tool is still running', () => {
    const view = renderSeat(group(false, { running: true, runningTool: 'bash' }))
    expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('true')
    expect(body(view.container)?.hasAttribute('data-folded')).toBe(false)
    // DSH ChatGroupSeat activity vocabulary for community CSS.
    expect(view.container.querySelector('[data-process-activity]')?.getAttribute('data-process-activity'))
      .toBe('commands')
  })

  it('folds an open Turn once every tool has settled (answer may still stream)', async () => {
    // Standard mode: process collapses when the tool burst ends — not only
    // after turn/end — so the final answer is not watched with the run open.
    const view = renderSeat(group(false, { running: false }))
    await vi.waitFor(() => {
      expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
    })
    expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('false')
  })

  it('re-opens when a new tool burst starts on the same Turn', async () => {
    const view = renderSeat(group(false, { running: false }))
    await vi.waitFor(() => {
      expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
    })
    view.rerender(
      <ProcessGroupSeat
        entry={group(false, { running: true, runningTool: 'bash', toolNames: ['bash', 'Read'] })}
        nodeSeat={seat}
        t={t}
        foldWhen="process"
        detailTitles
        liveProcessDetail
      />,
    )
    await vi.waitFor(() => {
      expect(body(view.container)?.hasAttribute('data-folded')).toBe(false)
    })
    expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps a thinking-only open Turn flat until close or idle', () => {
    const view = renderSeat(group(false, {
      tools: 0,
      reasoning: 1,
      toolNames: [],
      toolCallNames: [],
      running: false,
    }))
    expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('true')
    expect(body(view.container)?.hasAttribute('data-folded')).toBe(false)
  })

  it('folds a closed Turn when the reader was away from the floor', () => {
    // Already settled on mount → first paint is folded (no open flash).
    const view = renderSeat(group(true))
    expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('false')
    expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
  })

  it('folds a closing Turn even when the reader is at the floor', () => {
    const view = renderSeat(group(true))
    // Standard mode promises auto-fold on completion; floor-follow must not
    // leave the run permanently open — and must not flash open first.
    expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
    expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('false')
  })

  it('mounts a settled run folded without compensation writes', () => {
    // Mount-already-folded skips the open flash; no above-viewport compensation.
    const writes: Array<[HTMLElement, number]> = []
    const view = render(
      <div data-conversation-scroll>
        <ProcessGroupSeat
          entry={group(true)}
          nodeSeat={seat}
          t={t}
          foldWhen="process"
          detailTitles
          liveProcessDetail
          writeScroll={(el, top) => writes.push([el, top])}
        />
      </div>,
    )
    expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
    expect(writes).toHaveLength(0)
  })

  it('collapses an in-view settled run without scroll compensation writes', async () => {
    // Body takes `hidden="until-found"` (DSH). Floor fill is viewArea
    // min-height — no turn spacer and no scrollTop write for in-view folds.
    const writes: Array<[HTMLElement, number]> = []
    const view = render(
      <div data-conversation-scroll>
        <ProcessGroupSeat
          entry={group(false, { running: true, runningTool: 'bash', toolCallNames: ['bash'] })}
          nodeSeat={seat}
          t={t}
          foldWhen="process"
          detailTitles
          liveProcessDetail
          writeScroll={(el, top) => writes.push([el, top])}
        />
      </div>,
    )
    const root = view.container.querySelector<HTMLElement>('[data-process-group]')!
    const scrollport = view.container.querySelector<HTMLElement>('[data-conversation-scroll]')!
    scrollport.getBoundingClientRect = () => rectOf(0, 600)
    root.getBoundingClientRect = () => rectOf(120, 220)
    expect(body(view.container)?.hasAttribute('data-folded')).toBe(false)
    view.rerender(
      <div data-conversation-scroll>
        <ProcessGroupSeat
          entry={group(false, { running: false, toolCallNames: ['bash'] })}
          nodeSeat={seat}
          t={t}
          foldWhen="process"
          detailTitles
          liveProcessDetail
          writeScroll={(el, top) => writes.push([el, top])}
        />
      </div>,
    )
    await vi.waitFor(() => {
      expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
      expect(body(view.container)?.getAttribute('hidden')).toBe('until-found')
    })
    expect(writes).toHaveLength(0)
  })

  it('auto-folds above the reader and compensates the lost height', async () => {
    // Same path as a manual fold: measure before latch, restore after commit.
    // Keep the scrollport + seat DOM stable across the settle flip so rootRef
    // and the mocked rects stay the nodes the driver measures.
    const writes: Array<[HTMLElement, number]> = []
    const writeScroll = (el: HTMLElement, top: number): void => { writes.push([el, top]) }
    const seatProps = {
      nodeSeat: seat,
      t,
      foldWhen: 'process' as const,
      detailTitles: true,
      liveProcessDetail: true,
      writeScroll,
    }
    const view = render(
      <div data-conversation-scroll>
        <ProcessGroupSeat
          entry={group(false, { running: true, runningTool: 'bash', toolCallNames: ['bash'] })}
          {...seatProps}
        />
      </div>,
    )
    const scrollport = view.container.querySelector<HTMLElement>('[data-conversation-scroll]')!
    const root = view.container.querySelector<HTMLElement>('[data-process-group]')!
    Object.defineProperty(scrollport, 'scrollHeight', { value: 1200, configurable: true })
    Object.defineProperty(scrollport, 'clientHeight', { value: 600, configurable: true })
    scrollport.scrollTop = 400
    scrollport.getBoundingClientRect = () => rectOf(0, 600)
    let reads = 0
    root.getBoundingClientRect = () => {
      reads += 1
      // First sample (pre-latch) entirely above the scrollport; post-commit
      // lower edge climbed by 80 — rows below would jump without compensation.
      const bottom = reads === 1 ? -100 : -180
      return rectOf(bottom - 100, bottom)
    }
    view.rerender(
      <div data-conversation-scroll>
        <ProcessGroupSeat
          entry={group(false, { running: false, toolCallNames: ['bash'] })}
          {...seatProps}
        />
      </div>,
    )
    await vi.waitFor(() => {
      expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
    })
    expect(writes).toHaveLength(1)
    expect(writes[0]?.[0]).toBe(scrollport)
    expect(writes[0]?.[1]).toBe(320)
  })

  it('never conditionally renders the body, so folded rows keep their anchors', async () => {
    const view = renderSeat(group(true))
    await vi.waitFor(() => {
      expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
    })
    // `display: none` members would drop out of the data-chat-anchor-key order
    // the scroll restore reads; the body must still be mounted while folded.
    expect(body(view.container)).not.toBeNull()
  })

  it('pins the reader choice over the latch', async () => {
    const view = renderSeat(group(true))
    await vi.waitFor(() => {
      expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('false')
      expect(body(view.container)?.getAttribute('hidden')).toBe('until-found')
    })
    fireEvent.click(toggle(view.container) as HTMLElement)
    expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('true')
    expect(body(view.container)?.hasAttribute('hidden')).toBe(false)
    fireEvent.click(toggle(view.container) as HTMLElement)
    expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('false')
    expect(body(view.container)?.getAttribute('hidden')).toBe('until-found')
  })

  it('gives the height a fold above the reader would eat back to the offset', () => {
    const writes: Array<[HTMLElement, number]> = []
    // Keep a tool in flight so the seat starts open; this case measures a
    // manual fold, not the auto-fold-on-tools-settled path.
    const { view, scrollport, root } = stageFold(
      group(false, { running: true, runningTool: 'bash' }),
      (el, top) => writes.push([el, top]),
    )
    // First read is the open run, the second is the committed folded run: the
    // lower edge climbs by 80, which is exactly the distance the rows below it
    // would have jumped.
    let reads = 0
    root.getBoundingClientRect = () => {
      reads += 1
      const bottom = reads === 1 ? -100 : -180
      return rectOf(bottom - 100, bottom)
    }
    fireEvent.click(toggle(view.container) as HTMLElement)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.[0]).toBe(scrollport)
    expect(writes[0]?.[1]).toBe(320)
  })

  it('does not compensate scroll when the reader can see the run folding', () => {
    const writes: Array<[HTMLElement, number]> = []
    const { view, root } = stageFold(
      group(false, { running: true, runningTool: 'bash' }),
      (el, top) => writes.push([el, top]),
    )
    root.getBoundingClientRect = () => rectOf(120, 220)
    fireEvent.click(toggle(view.container) as HTMLElement)
    // In-view collapse is CSS-instant; compensating here would jump the floor.
    expect(writes).toHaveLength(0)
  })

  it('re-samples the reading anchor once a fold has landed', () => {
    const onFoldSettled = vi.fn()
    const view = renderSeat(group(false, { running: true, runningTool: 'bash' }), { onFoldSettled })
    // Mount is not a fold: sampling there would clobber a position a remount
    // just restored.
    expect(onFoldSettled).not.toHaveBeenCalled()
    fireEvent.click(toggle(view.container) as HTMLElement)
    expect(onFoldSettled).toHaveBeenCalledTimes(1)
    // Unfolding moves the rows back, so the anchor is stale there too.
    fireEvent.click(toggle(view.container) as HTMLElement)
    expect(onFoldSettled).toHaveBeenCalledTimes(2)
  })

  it('folds a closing run even while the reader can see it', async () => {
    const view = render(
      <div data-conversation-scroll>
        <ProcessGroupSeat
          entry={group(false, { running: true, runningTool: 'bash' })}
          nodeSeat={seat}
          t={t}
          foldWhen="process"
          detailTitles
          liveProcessDetail
        />
      </div>,
    )
    const scrollport = view.container.querySelector<HTMLElement>('[data-conversation-scroll]')!
    const root = view.container.querySelector<HTMLElement>('[data-process-group]')!
    scrollport.getBoundingClientRect = () => rectOf(0, 600)
    root.getBoundingClientRect = () => rectOf(100, 200)
    view.rerender(
      <div data-conversation-scroll>
        <ProcessGroupSeat
          entry={group(true)}
          nodeSeat={seat}
          t={t}
          foldWhen="process"
          detailTitles
          liveProcessDetail
        />
      </div>,
    )
    await vi.waitFor(() => {
      expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
    })
  })

  it('keeps a closed Turn flat when the mode never folds', async () => {
    const view = renderSeat(group(true), { foldWhen: 'never' })
    // `verbose` in the work-details mode: a settled run stays exactly as it is.
    await vi.waitFor(() => {
      expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('true')
    })
    expect(body(view.container)?.hasAttribute('data-folded')).toBe(false)
  })

  it('folds an open Turn once the session is idle and every tool has settled', async () => {
    // Host cleared `running` (session-status) but mux never delivered turn/end.
    const view = renderSeat(group(false, { running: false }), {
      foldWhen: 'process',
      idleSettled: true,
    })
    await vi.waitFor(() => {
      expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
    })
    expect(view.container.querySelector('[data-process-running]')).toBeNull()
  })

  it('folds after a mode flip that starts allowing fold on an already-closed Turn', async () => {
    const entry = group(true)
    const view = renderSeat(entry, { foldWhen: 'never' })
    expect(body(view.container)?.hasAttribute('data-folded')).toBe(false)
    view.rerender(
      <ProcessGroupSeat
        entry={entry}
        nodeSeat={seat}
        t={t}
        foldWhen="process"
        detailTitles
        liveProcessDetail
      />,
    )
    // Must not have latched `'open'` while fold was disallowed — Standard after
    // Verbose still auto-folds a Turn that already closed.
    await vi.waitFor(() => {
      expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
    })
  })

  it('uses a Cursor-style activity line as the folded title', async () => {
    const view = renderSeat(group(true))
    await vi.waitFor(() => {
      expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
    })
    // Folded chrome replaces「过程 · N 步」with verb + counts — no tool names,
    // no process title prefix, and no summary seat beside the title.
    expect(view.container.textContent).toContain('chat.process.summary.explored')
    expect(view.container.textContent).toContain('chat.process.summary.commands')
    expect(view.container.textContent).toContain('chat.process.summary.thoughts')
    expect(view.container.textContent).not.toContain('chat.process.title')
    expect(view.container.textContent).not.toContain('bash')
    expect(summary(view.container)).toBeNull()
  })

  it('keeps step counts on an open quiet-mode header', () => {
    // Quiet modes drop the taxonomy while the run is still open; once folded
    // the title becomes the activity line (same for every mode).
    const view = renderSeat(
      group(false, { running: true, runningTool: 'bash', toolCallNames: ['bash'] }),
      { detailTitles: false, liveProcessDetail: false },
    )
    expect(body(view.container)?.hasAttribute('data-folded')).toBe(false)
    expect(summary(view.container)?.textContent).toContain('chat.process.steps')
    expect(summary(view.container)?.textContent).not.toContain('bash')
  })

  it('shows the running tool with the live shimmer class while open', () => {
    const view = renderSeat(group(false, {
      running: true,
      runningTool: 'bash',
      toolNames: ['bash'],
      toolCallNames: ['bash'],
    }))
    expect(view.container.querySelector('[data-process-running]')).not.toBeNull()
    expect(summary(view.container)?.textContent).toBe('bash')
    expect(summary(view.container)?.className).toMatch(/processGroupSummaryLive/)
  })

  it('keeps「过程」+ live tool shimmer on a folded immediate run', () => {
    // foldWhen=immediate (axis point): chrome must still name the in-flight tool
    // with the sweep — live is not gated on `!settled` / quiet settled titles.
    // Title stays「过程」so a folded live run never reads as a bare tool row.
    const view = renderSeat(
      group(false, {
        running: true,
        runningTool: 'bash',
        toolNames: ['bash'],
        toolCallNames: ['bash'],
      }),
      { foldWhen: 'immediate', liveProcessDetail: false, detailTitles: false },
    )
    expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
    expect(body(view.container)?.getAttribute('hidden')).toBe('until-found')
    expect(view.container.querySelector('[data-process-running]')).not.toBeNull()
    expect(view.container.textContent).toContain('chat.process.title')
    expect(summary(view.container)?.textContent).toBe('bash')
    expect(summary(view.container)?.className).toMatch(/processGroupSummaryLive/)
  })

  it('swaps the folded live tool for the activity line once the burst settles', async () => {
    const view = renderSeat(
      group(false, {
        running: true,
        runningTool: 'bash',
        toolNames: ['bash'],
        toolCallNames: ['bash'],
      }),
      { foldWhen: 'immediate', liveProcessDetail: false, detailTitles: false },
    )
    expect(summary(view.container)?.className).toMatch(/processGroupSummaryLive/)
    view.rerender(
      <ProcessGroupSeat
        entry={group(false, {
          running: false,
          toolNames: ['bash'],
          toolCallNames: ['bash'],
        })}
        nodeSeat={seat}
        t={t}
        foldWhen="immediate"
        detailTitles={false}
        liveProcessDetail={false}
      />,
    )
    await vi.waitFor(() => {
      expect(view.container.querySelector('[data-process-running]')).toBeNull()
    })
    expect(view.container.textContent).toContain('chat.process.summary.commands')
    expect(view.container.textContent).not.toContain('bash')
    expect(summary(view.container)).toBeNull()
    expect(view.container.innerHTML).not.toMatch(/processGroupSummaryLive/)
  })

  it('shimmers an open run that is still only thinking', () => {
    const view = renderSeat(group(false, {
      tools: 0,
      reasoning: 1,
      toolNames: [],
      toolCallNames: [],
      running: false,
      runningTool: undefined,
    }))
    expect(view.container.querySelector('[data-process-running]')).not.toBeNull()
    expect(summary(view.container)?.textContent).toBe('think.title')
    expect(summary(view.container)?.className).toMatch(/processGroupSummaryLive/)
  })

  it('stops the live shimmer once every tool has settled on an still-open Turn', () => {
    // Keep foldWhen=turn so the run stays expanded while tools are done —
    // standard would latch closed and drop the open-run summary seat.
    const view = renderSeat(group(false, {
      tools: 2,
      reasoning: 1,
      toolNames: ['bash', 'Read'],
      toolCallNames: ['bash', 'Read'],
      running: false,
      runningTool: undefined,
    }), { foldWhen: 'turn' })
    expect(view.container.querySelector('[data-process-running]')).toBeNull()
    expect(summary(view.container)?.className).not.toMatch(/processGroupSummaryLive/)
    expect(summary(view.container)?.textContent).toContain('bash')
  })

  it('toggles from a click on the whole disclosure row', () => {
    const view = renderSeat(group(false, { running: true, runningTool: 'bash' }))
    const row = view.container.querySelector('[data-disclosure-row]') as HTMLElement
    expect(row.hasAttribute('data-expandable')).toBe(true)
    expect(body(view.container)?.hasAttribute('data-folded')).toBe(false)
    fireEvent.click(row)
    expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
  })

  it('separates the process title from the open-run summary', () => {
    const view = renderSeat(group(false, { running: true, runningTool: 'bash' }))
    // DisclosureRow puts title then collapsedContent; the sep is aria-hidden.
    const row = view.container.querySelector('[data-disclosure-row]')
    expect(row?.textContent).toContain('chat.process.title')
    expect(row?.querySelector('[aria-hidden]')).not.toBeNull()
    expect(summary(view.container)).not.toBeNull()
  })
})
