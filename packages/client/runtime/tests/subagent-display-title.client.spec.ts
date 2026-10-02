import { describe, expect, it } from 'vitest'
import type { SessionId } from '@xrkseek/client-runtime/client'
import { subagentDisplayTitle } from '../src/client/sessions/service.ts'

const ID = 'child-abc' as SessionId

describe('subagentDisplayTitle', () => {
  it('keeps a substantive catalog label', () => {
    expect(subagentDisplayTitle('扫描改动', 'ignored', ID)).toBe('扫描改动')
  })

  it('prefers the durable session title over numeric or stub labels', () => {
    expect(subagentDisplayTitle('1', '正在整理概况面板', ID)).toBe('正在整理概况面板')
    expect(subagentDisplayTitle('subagent', 'worker title', ID)).toBe('worker title')
    expect(subagentDisplayTitle('subagent-task', 'one-shot work', ID)).toBe('one-shot work')
  })

  it('falls back to id when both label and title are missing', () => {
    expect(subagentDisplayTitle(undefined, undefined, ID)).toBe(ID)
    expect(subagentDisplayTitle('  ', '', ID)).toBe(ID)
  })
})
