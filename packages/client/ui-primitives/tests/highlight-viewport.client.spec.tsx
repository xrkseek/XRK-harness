// @vitest-environment jsdom
// Viewport-activated highlighting: offscreen CodeBlock/ReadBlock stay on the
// plain arm until first intersection; activation is one-way; unsupported
// languages never register; missing IntersectionObserver activates immediately.

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadBlock } from '../src/ReadBlock.tsx'
import { CodeBlock } from '../src/markdown/CodeBlock.tsx'

class IntersectionObserverStub {
  static instances: IntersectionObserverStub[] = []

  readonly observed = new Set<Element>()
  readonly unobserved = new Set<Element>()
  disconnected = false

  constructor(private readonly callback: IntersectionObserverCallback) {
    IntersectionObserverStub.instances.push(this)
  }

  observe(element: Element): void {
    this.observed.add(element)
  }

  unobserve(element: Element): void {
    this.observed.delete(element)
    this.unobserved.add(element)
  }

  disconnect(): void {
    this.disconnected = true
    this.observed.clear()
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  intersect(element: Element, isIntersecting: boolean): void {
    this.callback(
      [{ target: element, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
}

beforeEach(() => {
  IntersectionObserverStub.instances = []
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('viewport-activated syntax highlighting', () => {
  it('keeps offscreen blocks plain and permanently activates only intersecting blocks', async () => {
    const view = render(
      <>
        <CodeBlock code="const first = 1" lang="ts" />
        <CodeBlock code="const second = 2" lang="ts" />
        <CodeBlock code="const third = 3" lang="ts" />
      </>,
    )
    const blocks = [...view.container.querySelectorAll('.md-code-block')]
    expect(blocks).toHaveLength(3)
    expect(IntersectionObserverStub.instances).toHaveLength(1)
    const observer = IntersectionObserverStub.instances[0]!
    expect(observer.observed.size).toBe(3)
    expect(view.container.querySelectorAll('pre.shiki')).toHaveLength(0)

    act(() => { observer.intersect(blocks[0]!, false) })
    expect(view.container.querySelectorAll('pre.shiki')).toHaveLength(0)

    act(() => {
      observer.intersect(blocks[0]!, true)
      observer.intersect(blocks[1]!, true)
    })
    await waitFor(() => {
      expect(blocks[0]!.querySelector('pre.shiki')).not.toBeNull()
      expect(blocks[1]!.querySelector('pre.shiki')).not.toBeNull()
    })
    expect(blocks[2]!.querySelector('pre.shiki')).toBeNull()
    expect(observer.unobserved.has(blocks[0]!)).toBe(true)

    act(() => { observer.intersect(blocks[0]!, false) })
    expect(blocks[0]!.querySelector('pre.shiki')).not.toBeNull()

    view.rerender(
      <>
        <CodeBlock code="const first = 10" lang="ts" />
        <CodeBlock code="const second = 2" lang="ts" />
        <CodeBlock code="const third = 3" lang="ts" />
      </>,
    )
    expect(blocks[0]!.querySelector('pre.shiki')?.textContent).toBe('const first = 10')

    act(() => { observer.intersect(blocks[2]!, true) })
    await waitFor(() => { expect(blocks[2]!.querySelector('pre.shiki')).not.toBeNull() })
    expect(observer.disconnected).toBe(true)
  })

  it('does not observe an unsupported language', () => {
    const view = render(
      <CodeBlock code="IDENTIFICATION DIVISION." lang="cobol" />,
    )
    expect(view.container.querySelector('pre.shiki')).toBeNull()
    expect(IntersectionObserverStub.instances).toHaveLength(0)
  })

  it('releases the shared observer when the last pending block unmounts', () => {
    const view = render(<CodeBlock code="const pending = true" lang="ts" />)
    const block = view.container.querySelector('.md-code-block')!
    const observer = IntersectionObserverStub.instances[0]!

    view.unmount()

    expect(observer.unobserved.has(block)).toBe(true)
    expect(observer.disconnected).toBe(true)
  })

  it('highlights immediately when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const view = render(<CodeBlock code="const fallback = true" lang="ts" />)
    expect(view.container.querySelector('pre.shiki')).not.toBeNull()
  })

  it('keeps a read card plain until that card intersects', async () => {
    const view = render(
      <ReadBlock
        label="data.json"
        lang="json"
        lines={[{ number: 1, text: '{"ready":true}' }]}
        totalLines={1}
      />,
    )
    const block = view.container.querySelector('[data-read]')!
    expect(block.querySelectorAll('[class*="content"] span')).toHaveLength(0)
    const observer = IntersectionObserverStub.instances[0]!

    act(() => { observer.intersect(block, true) })
    await waitFor(() => {
      expect(block.querySelectorAll('[class*="content"] span[style]').length).toBeGreaterThan(1)
    })
  })
})
