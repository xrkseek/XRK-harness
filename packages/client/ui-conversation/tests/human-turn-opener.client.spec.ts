import { describe, expect, it } from 'vitest'
import { humanTurnOpenerForRegenerate } from '../src/client/chat/human-turn-opener.ts'

describe('humanTurnOpenerForRegenerate', () => {
  it('picks the first human-owned user opener', () => {
    const content = [{ type: 'text', text: 'hello' }]
    expect(humanTurnOpenerForRegenerate([
      {
        kind: 'user',
        data: {
          seq: 10,
          content,
          source: { kind: 'user' },
        },
      },
    ])).toEqual({ seq: 10, text: 'hello', content })
  })

  it('skips seat and auto-continue openers (never regenerate as 老板)', () => {
    expect(humanTurnOpenerForRegenerate([
      {
        kind: 'user',
        data: {
          seq: 1,
          content: [{ type: 'text', text: 'delegator task' }],
          source: {
            kind: 'seat',
            form: 'speech',
            channel: 'parent',
            fromSessionId: 'sess_mgr',
            label: '经理',
          },
        },
      },
    ])).toBeNull()
    expect(humanTurnOpenerForRegenerate([
      {
        kind: 'user',
        data: {
          seq: 2,
          content: [{ type: 'text', text: '继续' }],
          source: { kind: 'auto-continue', round: 1 },
        },
      },
    ])).toBeNull()
  })

  it('skips steering and empty text without media', () => {
    expect(humanTurnOpenerForRegenerate([
      {
        kind: 'steering',
        data: {
          seq: 3,
          content: [{ type: 'text', text: 'mid' }],
          source: { kind: 'user' },
        },
      },
      {
        kind: 'user',
        data: {
          seq: 4,
          content: [{ type: 'text', text: '   ' }],
          source: { kind: 'user' },
        },
      },
    ])).toBeNull()
  })

  it('accepts attachment-only human openers', () => {
    const content = [{
      type: 'file',
      attachment: {
        attachmentId: 'sha256:abc',
        name: 'cover.docx',
        bytes: 12,
        mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    }]
    expect(humanTurnOpenerForRegenerate([
      {
        kind: 'user',
        data: { seq: 7, content, source: { kind: 'user' } },
      },
    ])).toEqual({ seq: 7, text: '', content })
  })
})
