// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ProcessGroupSeat } from '../src/client/chat/ProcessGroupSeat.tsx'
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
    deferFold: boolean
    foldCompletedTurns: boolean
    detailTitles: boolean
    liveProcessDetail: boolean
    writeScroll: (scrollport: HTMLElement, top: number) => void
    onFoldSettled: () => void
  }> = {},
) {
  const props = {
    deferFold: false,
    foldCompletedTurns: true,
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
        deferFold={false}
        foldCompletedTurns
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
  it('keeps an open Turn flat', () => {
    const view = renderSeat(group(false))
    expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('true')
    expect(body(view.container)?.hasAttribute('data-folded')).toBe(false)
  })

  it('folds a closed Turn when the reader was away from the floor', async () => {
    const view = renderSeat(group(true))
    await vi.waitFor(() => {
      expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('false')
    })
    expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
  })

  it('folds a closing Turn even when the reader is at the floor', async () => {
    const view = renderSeat(group(true), { deferFold: true })
    // Standard mode promises auto-fold on completion; floor-follow must not
    // leave the run permanently open.
    await vi.waitFor(() => {
      expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
    })
    expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('false')
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
    const view = renderSeat(group(true), { deferFold: true })
    await vi.waitFor(() => {
      expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('false')
    })
    fireEvent.click(toggle(view.container) as HTMLElement)
    expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle(view.container) as HTMLElement)
    expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('false')
  })

  it('gives the height a fold above the reader would eat back to the offset', () => {
    const writes: Array<[HTMLElement, number]> = []
    const { view, scrollport, root } = stageFold(group(false), (el, top) => writes.push([el, top]))
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

  it('keeps the transition when the reader can see the run folding', () => {
    const writes: Array<[HTMLElement, number]> = []
    const { view, root } = stageFold(group(false), (el, top) => writes.push([el, top]))
    root.getBoundingClientRect = () => rectOf(120, 220)
    fireEvent.click(toggle(view.container) as HTMLElement)
    // A run in view is the thing the reader is watching; restoring the offset
    // there would fight the animation instead of protecting the reading line.
    expect(writes).toHaveLength(0)
    expect(root.hasAttribute('data-instant')).toBe(false)
  })

  it('re-samples the reading anchor once a fold has landed', () => {
    const onFoldSettled = vi.fn()
    const view = renderSeat(group(false), { onFoldSettled })
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
          entry={group(false)}
          nodeSeat={seat}
          t={t}
          deferFold={false}
          foldCompletedTurns
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
          deferFold={false}
          foldCompletedTurns
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
    const view = renderSeat(group(true), { foldCompletedTurns: false })
    // `verbose` in the work-details mode: a settled run stays exactly as it is.
    await vi.waitFor(() => {
      expect(toggle(view.container)?.getAttribute('aria-expanded')).toBe('true')
    })
    expect(body(view.container)?.hasAttribute('data-folded')).toBe(false)
  })

  it('counts steps instead of naming them in quiet modes', async () => {
    const view = renderSeat(group(true), { detailTitles: false })
    await vi.waitFor(() => {
      expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
    })
    // The stub keeps the key and its params, so the count must survive the mode.
    expect(view.container.textContent).toContain('chat.process.steps')
    expect(view.container.textContent).not.toContain('bash')
  })

  it('names tools on a settled detailed header', async () => {
    const view = renderSeat(group(true))
    await vi.waitFor(() => {
      expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
    })
    expect(summary(view.container)?.textContent).toContain('bash')
    expect(summary(view.container)?.textContent).toContain('Read')
  })

  it('shows the running tool with the live shimmer class while open', () => {
    const view = renderSeat(group(false, { running: true, runningTool: 'bash', toolNames: ['bash'] }))
    expect(view.container.querySelector('[data-process-running]')).not.toBeNull()
    expect(summary(view.container)?.textContent).toBe('bash')
    expect(summary(view.container)?.className).toMatch(/processGroupSummaryLive/)
  })

  it('shimmers an open run even before any tool is in flight', () => {
    const view = renderSeat(group(false, {
      tools: 0,
      reasoning: 1,
      toolNames: [],
      running: false,
      runningTool: undefined,
    }))
    expect(view.container.querySelector('[data-process-running]')).not.toBeNull()
    expect(summary(view.container)?.textContent).toBe('think.title')
    expect(summary(view.container)?.className).toMatch(/processGroupSummaryLive/)
  })

  it('toggles from a click on the whole disclosure row', () => {
    const view = renderSeat(group(false))
    const row = view.container.querySelector('[data-disclosure-row]') as HTMLElement
    expect(row.hasAttribute('data-expandable')).toBe(true)
    fireEvent.click(row)
    expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
  })

  it('separates the process title from the summary', async () => {
    const view = renderSeat(group(true))
    await vi.waitFor(() => {
      expect(body(view.container)?.hasAttribute('data-folded')).toBe(true)
    })
    // DisclosureRow puts title then collapsedContent; the sep is aria-hidden.
    const row = view.container.querySelector('[data-disclosure-row]')
    expect(row?.querySelector('[aria-hidden]')).not.toBeNull()
    expect(summary(view.container)).not.toBeNull()
  })
})
