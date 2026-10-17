import { describe, expect, it } from 'vitest'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'
import {
  sameTurnNavigationItem,
  turnNavigationItem,
} from '../src/client/conversation-nodes/turn-navigation.ts'

function storeOf(nodes: readonly ChatNode[]) {
  const byKey = new Map(nodes.map(node => [node.key, node]))
  return {
    get: (key: string) => byKey.get(key),
    values: () => nodes,
  }
}

function locationsOf(turn: number, keys: readonly string[]) {
  return {
    getTurn: (t: number) => (t === turn ? keys : []),
    getStep: () => [],
  }
}

describe('turnNavigationItem', () => {
  it('keeps response preview stable while the assistant step is still running', () => {
    const user = {
      kind: 'user' as const,
      key: 'u1',
      anchorSeq: 1,
      visibility: 'visible' as const,
      location: { kind: 'turn' as const, turn: { turn: 1 } },
      data: {
        seq: 1,
        content: [{ type: 'text', text: 'hello' }],
      },
    } as unknown as ChatNode

    const running = {
      kind: 'assistant-step' as const,
      key: 'a1',
      anchorSeq: 2,
      visibility: 'visible' as const,
      location: { kind: 'step' as const, turn: { turn: 1 }, step: 1 },
      data: {
        status: 'running',
        turn: 1,
        step: 1,
        blocks: [{ kind: 'text', text: 'partial answer growing' }],
        time: 2,
      },
    } as unknown as ChatNode

    const settled = {
      ...running,
      data: {
        ...running.data,
        status: 'settled',
        blocks: [{ kind: 'text', text: 'final answer' }],
      },
    } as unknown as ChatNode

    const locations = locationsOf(1, ['u1', 'a1'])
    const whileRunning = turnNavigationItem(1, locations, storeOf([user, running]))
    const whileRunningAgain = turnNavigationItem(1, locations, storeOf([
      user,
      {
        ...running,
        data: {
          ...running.data,
          blocks: [{ kind: 'text', text: 'partial answer growing even more tokens' }],
        },
      } as unknown as ChatNode,
    ]))
    expect(whileRunning?.response).toBe('')
    expect(sameTurnNavigationItem(whileRunning, whileRunningAgain)).toBe(true)

    const afterSettle = turnNavigationItem(1, locations, storeOf([user, settled]))
    expect(afterSettle?.response).toBe('final answer')
    expect(sameTurnNavigationItem(whileRunning, afterSettle)).toBe(false)
  })
})
