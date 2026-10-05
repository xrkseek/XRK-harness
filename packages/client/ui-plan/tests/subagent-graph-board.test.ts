import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SubagentGraphBoard } from '../src/client/SubagentGraphBoard.tsx'

describe('SubagentGraphBoard', () => {
  it('synthesizes a root→live star when the team graph is empty', () => {
    const html = renderToStaticMarkup(createElement(SubagentGraphBoard, {
      sessionId: 'parent',
      rootLabel: 'Session',
      nodes: [],
      edges: [],
      live: [
        { id: 'child-a', label: 'scout', activity: 'running', mode: 'continuable', liveTool: 'bash' },
        { id: 'child-b', label: 'writer', activity: 'inactive', mode: 'one-shot' },
      ],
      emptyLabel: 'empty',
      runningLabel: 'running',
      idleLabel: 'done',
    }))
    expect(html).toContain('data-subagent-graph')
    expect(html).toContain('scout')
    expect(html).toContain('writer')
    expect(html).toContain('data-activity="running"')
    expect(html).toContain('data-activity="inactive"')
    expect(html).not.toContain('empty')
  })

  it('keeps the depth-0 parent running while a graph child is running', () => {
    const html = renderToStaticMarkup(createElement(SubagentGraphBoard, {
      sessionId: 'child',
      rootLabel: 'Session',
      nodes: [
        { id: 'parent', label: 'Session', depth: 0, activity: 'inactive' },
        { id: 'child', label: 'scout', depth: 1, activity: 'inactive' },
        { id: 'sib', label: 'writer', depth: 1, activity: 'running' },
      ],
      edges: [
        { from: 'parent', to: 'child', kind: 'delegates' },
        { from: 'parent', to: 'sib', kind: 'delegates' },
      ],
      live: [],
      emptyLabel: 'empty',
      runningLabel: 'running',
      idleLabel: 'done',
    }))
    expect(html).toMatch(/data-depth="0"[^>]*data-activity="running"|data-activity="running"[^>]*data-depth="0"/)
  })

  it('keeps the depth-0 parent running while a live child is running', () => {
    const html = renderToStaticMarkup(createElement(SubagentGraphBoard, {
      sessionId: 'parent',
      rootLabel: 'Session',
      nodes: [
        { id: 'parent', label: 'Session', depth: 0, activity: 'inactive' },
        { id: 'child-a', label: 'scout', depth: 1, activity: 'inactive' },
      ],
      edges: [{ from: 'parent', to: 'child-a', kind: 'delegates' }],
      live: [
        { id: 'child-a', label: 'scout', activity: 'running', mode: 'continuable' },
      ],
      emptyLabel: 'empty',
      runningLabel: 'running',
      idleLabel: 'done',
    }))
    expect(html).toMatch(/data-depth="0"[^>]*data-activity="running"|data-activity="running"[^>]*data-depth="0"/)
  })

  it('paints a parent-aborted idle child as error, not done', () => {
    const html = renderToStaticMarkup(createElement(SubagentGraphBoard, {
      sessionId: 'parent',
      rootLabel: 'Session',
      nodes: [
        { id: 'parent', label: 'Session', depth: 0 },
        { id: 'child-a', label: 'scout', depth: 1, activity: 'inactive' },
      ],
      edges: [{ from: 'parent', to: 'child-a', kind: 'delegates' }],
      live: [
        {
          id: 'child-a',
          label: 'scout',
          activity: 'inactive',
          mode: 'one-shot',
          outcome: { kind: 'aborted', cause: 'parent' },
        },
      ],
      emptyLabel: 'empty',
      runningLabel: 'running',
      idleLabel: 'done',
    }))
    expect(html).toContain('data-outcome="aborted"')
    expect(html).toContain('data-state="error"')
  })

  it('joins live activity onto existing graph nodes', () => {
    const html = renderToStaticMarkup(createElement(SubagentGraphBoard, {
      sessionId: 'parent',
      rootLabel: 'Session',
      nodes: [
        { id: 'parent', label: 'Session', depth: 0 },
        { id: 'child-a', label: 'scout', depth: 1, activity: 'inactive' },
      ],
      edges: [{ from: 'parent', to: 'child-a', kind: 'delegates' }],
      live: [
        { id: 'child-a', label: 'scout', activity: 'running', mode: 'continuable' },
      ],
      emptyLabel: 'empty',
      runningLabel: 'running',
      idleLabel: 'done',
    }))
    expect(html).toContain('data-activity="running"')
    expect(html).toContain('scout')
  })
})
