import { describe, expect, it } from 'vitest'
import type { ChatConversationViewNode } from '@xrkseek/client-runtime/client'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'
import { closedTurn, flowEntries, isProcessMember, turnOf } from '../src/client/conversation-nodes/process-groups.ts'

type Block = { readonly kind: 'text' | 'reasoning'; readonly text: string }

/** Minimal Chat node stub: only the fields the grouping reads. */
function stub(
  key: string,
  kind: string,
  options: {
    readonly turn?: number
    readonly status?: 'open' | 'closed' | 'unknown'
    readonly blocks?: readonly Block[]
  } = {},
): ChatNode {
  const turn = options.turn ?? 1
  return {
    key,
    kind,
    id: key,
    target: 'chat',
    anchorSeq: 0,
    visibility: 'visible',
    location: {
      kind: 'turn',
      turn: { turn, status: options.status ?? 'closed' },
    },
    data: options.blocks === undefined ? {} : { blocks: options.blocks },
  } as unknown as ChatNode
}

function entriesOf(
  nodes: readonly ChatNode[],
  options?: Parameters<typeof flowEntries>[2],
) {
  const byKey = new Map(nodes.map(node => [node.key, node as ChatConversationViewNode]))
  return flowEntries(nodes.map(node => node.key), key => byKey.get(key), options)
}

const tool = (key: string, options: Parameters<typeof stub>[2] = {}) => stub(key, 'tool-call', options)
const reasoningStep = (key: string, options: Parameters<typeof stub>[2] = {}) =>
  stub(key, 'assistant-step', { ...options, blocks: [{ kind: 'reasoning', text: 'thinking' }] })
const replyStep = (key: string, options: Parameters<typeof stub>[2] = {}) =>
  stub(key, 'assistant-step', { ...options, blocks: [{ kind: 'text', text: 'answer' }] })
const user = (key: string, options: Parameters<typeof stub>[2] = {}) => stub(key, 'user', options)

describe('flowEntries', () => {
  it('folds consecutive tool rows into one group and keeps the summary', () => {
    const entries = entriesOf([user('u1'), tool('t1'), tool('t2'), tool('t3')])
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({ kind: 'node', key: 'u1' })
    const group = entries[1]
    expect(group?.kind).toBe('group')
    if (group?.kind !== 'group') throw new Error('expected group')
    expect(group.summary).toEqual({
      tools: 3,
      reasoning: 0,
      toolNames: [],
      runningTool: undefined,
      running: false,
    })
    expect(group.members.map(member => member.key)).toEqual(['t1', 't2', 't3'])
    expect(group.closed).toBe(true)
    expect(group.key).toBe('process:t1')
  })

  it('keeps a lone process row inline instead of hiding it behind a header', () => {
    const entries = entriesOf([tool('t1'), replyStep('a1')])
    expect(entries).toEqual([
      { kind: 'node', key: 't1' },
      { kind: 'node', key: 'a1' },
    ])
  })

  it('counts a reasoning-only step as process and a reply step as the answer', () => {
    const entries = entriesOf([reasoningStep('r1', { turn: 2 }), tool('t1', { turn: 2 }), replyStep('a1', { turn: 2 })])
    expect(entries).toHaveLength(2)
    const group = entries[0]
    expect(group?.kind).toBe('group')
    if (group?.kind !== 'group') throw new Error('expected group')
    expect(group.summary).toEqual({
      tools: 1,
      reasoning: 1,
      toolNames: [],
      runningTool: undefined,
      running: false,
    })
    expect(group.turn).toBe(2)
    expect(entries[1]).toEqual({ kind: 'node', key: 'a1' })
  })

  it('never lets one group span a Turn boundary', () => {
    const entries = entriesOf([
      tool('a1', { turn: 1 }), tool('a2', { turn: 1 }),
      tool('b1', { turn: 2 }), tool('b2', { turn: 2 }),
    ])
    expect(entries.map(entry => entry.kind)).toEqual(['group', 'group'])
    expect(entries.map(entry => (entry.kind === 'group' ? entry.turn : undefined))).toEqual([1, 2])
  })

  it('flushes the run on any non-process row', () => {
    const entries = entriesOf([tool('t1'), tool('t2'), user('u1'), tool('t3'), tool('t4')])
    expect(entries.map(entry => entry.kind)).toEqual(['group', 'node', 'group'])
  })

  it('treats a missing node as a plain row so order never silently drops', () => {
    const entries = flowEntries(['ghost'], () => undefined)
    expect(entries).toEqual([{ kind: 'node', key: 'ghost' }])
  })

  it('keeps the first member as the group identity when rows append at the tail', () => {
    const before = entriesOf([tool('t1'), tool('t2')])
    const after = entriesOf([tool('t1'), tool('t2'), tool('t3')])
    const keyOf = (entries: ReturnType<typeof entriesOf>) =>
      entries.map(entry => (entry.kind === 'group' ? entry.key : entry.key))
    expect(keyOf(before)).toEqual(['process:t1'])
    expect(keyOf(after)).toEqual(['process:t1'])
  })

  it('collects unique tool names and the in-flight root', () => {
    const running = stub('t1', 'tool-call', {})
    ;(running as { data: unknown }).data = {
      root: { callId: 'c1', name: 'bash', argsRaw: '{}', turn: 1, step: 0, time: 0, callView: null, subCalls: [] },
    }
    const settled = stub('t2', 'tool-call', {})
    ;(settled as { data: unknown }).data = {
      root: {
        kind: 'tool-result',
        seq: 1,
        time: 0,
        callId: 'c2',
        call: { name: 'bash', argsRaw: '{}' },
        callTime: null,
        content: [],
        isError: false,
        callView: null,
        resultView: null,
        subCalls: [],
      },
    }
    const other = stub('t3', 'tool-call', {})
    ;(other as { data: unknown }).data = {
      root: {
        kind: 'tool-result',
        seq: 2,
        time: 0,
        callId: 'c3',
        call: { name: 'Read', argsRaw: '{}' },
        callTime: null,
        content: [],
        isError: false,
        callView: null,
        resultView: null,
        subCalls: [],
      },
    }
    const entries = entriesOf([running, settled, other])
    const group = entries[0]
    expect(group?.kind).toBe('group')
    if (group?.kind !== 'group') throw new Error('expected group')
    expect(group.summary.toolNames).toEqual(['bash', 'Read'])
    expect(group.summary.running).toBe(true)
    expect(group.summary.runningTool).toBe('bash')
  })
})

describe('node predicates', () => {
  it('reads the owning Turn and its closed status', () => {
    expect(turnOf(tool('t1', { turn: 7 }))).toBe(7)
    expect(closedTurn(tool('t1', { status: 'open' }))).toBe(false)
    expect(closedTurn(tool('t1', { status: 'closed' }))).toBe(true)
    expect(closedTurn(tool('t1', { status: 'unknown' }))).toBe(false)
  })

  it('prefers the timeline turnClosed callback over a stale member Location', () => {
    // Member Nodes still say open; timeline already saw turn/end.
    const entries = entriesOf(
      [tool('t1', { status: 'open' }), tool('t2', { status: 'open' })],
      { turnClosed: () => true },
    )
    expect(entries[0]?.kind).toBe('group')
    if (entries[0]?.kind !== 'group') throw new Error('expected group')
    expect(entries[0].closed).toBe(true)
  })

  it('keeps blank reasoning out of the process run', () => {
    const blank = stub('x', 'assistant-step', { blocks: [{ kind: 'reasoning', text: '   ' }] })
    expect(isProcessMember(blank)).toBe(false)
    expect(isProcessMember(reasoningStep('r'))).toBe(true)
    expect(isProcessMember(replyStep('a'))).toBe(false)
    expect(isProcessMember(tool('t'))).toBe(true)
  })

  it('never groups when the work-details mode asks for none', () => {
    const entries = entriesOf([tool('t1'), tool('t2')], { grouping: 'none' })
    expect(entries).toEqual([
      { kind: 'node', key: 't1' },
      { kind: 'node', key: 't2' },
    ])
  })

  it('keeps the live Turn flat and groups history in the history mode', () => {
    const nodes = [
      tool('t1', { turn: 1 }), tool('t2', { turn: 1 }),
      tool('t3', { turn: 2 }), tool('t4', { turn: 2 }),
    ]
    const entries = entriesOf(nodes, { grouping: 'history', latestTurn: 2 })
    // Turn 1 is history → one run; Turn 2 is what the reader is watching → flat.
    expect(entries.map(entry => entry.kind)).toEqual(['group', 'node', 'node'])
  })

  it('groups everything when the history mode has no live Turn yet', () => {
    const entries = entriesOf([tool('t1'), tool('t2')], { grouping: 'history', latestTurn: null })
    expect(entries[0]?.kind).toBe('group')
  })
})
