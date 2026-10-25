import { describe, expect, it } from 'vitest'
import {
  classifyProcessTool,
  countProcessActivity,
  formatProcessActivity,
} from '../src/client/conversation-nodes/process-activity.ts'

const t = ((key: string, params?: Record<string, unknown>) =>
  (params === undefined ? key : `${key}:${JSON.stringify(params)}`)) as Parameters<
    typeof formatProcessActivity
  >[1]

describe('classifyProcessTool', () => {
  it('maps common harness / Cursor tool names onto activity buckets', () => {
    expect(classifyProcessTool('Read')).toBe('files')
    expect(classifyProcessTool('read_file')).toBe('files')
    expect(classifyProcessTool('Grep')).toBe('searches')
    expect(classifyProcessTool('codebase_search')).toBe('searches')
    expect(classifyProcessTool('bash')).toBe('commands')
    expect(classifyProcessTool('Shell')).toBe('commands')
    expect(classifyProcessTool('StrReplace')).toBe('edits')
    expect(classifyProcessTool('web_search')).toBe('web')
    expect(classifyProcessTool('mystery')).toBe('other')
  })
})

describe('formatProcessActivity', () => {
  it('builds a Cursor-style activity line from classified calls', () => {
    const line = formatProcessActivity(
      countProcessActivity(['Read', 'Read', 'Grep', 'bash'], 1),
      t,
    )
    expect(line).toBe([
      'chat.process.summary.explored:{"count":2}',
      'chat.process.summary.searches:{"count":1}',
      'chat.process.summary.commands:{"count":1}',
      'chat.process.summary.thoughts:{"count":1}',
    ].join('chat.process.summary.join'))
  })

  it('falls back to a step count when nothing classified', () => {
    expect(formatProcessActivity(countProcessActivity([], 0), t)).toBe(
      'chat.process.steps:{"count":0}',
    )
  })
})
