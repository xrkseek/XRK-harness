import { describe, expect, it } from 'vitest'
import { projectTranscriptChrome } from '../src/client/sessions/transcript-chrome.ts'

describe('projectTranscriptChrome', () => {
  it('maps operator open / cutin', () => {
    expect(projectTranscriptChrome({ surface: 'user' })).toEqual({
      voice: 'operator',
      lane: 'open',
    })
    expect(projectTranscriptChrome({ surface: 'steering' })).toEqual({
      voice: 'operator',
      lane: 'cutin',
    })
  })

  it('maps seat act for tools and seat open for assistant', () => {
    expect(projectTranscriptChrome({ surface: 'tool' })).toEqual({
      voice: 'seat',
      lane: 'act',
    })
    expect(projectTranscriptChrome({ surface: 'assistant' })).toEqual({
      voice: 'seat',
      lane: 'open',
    })
  })

  it('maps subagent notice to courier × handoff', () => {
    expect(projectTranscriptChrome({
      surface: 'context',
      source: {
        kind: 'plugin',
        plugin: 'subagent',
        form: 'notice',
        childSessionId: 'sess_child',
      },
    })).toEqual({ voice: 'courier', lane: 'handoff' })
  })

  it('maps recall / relay / runtime brief', () => {
    expect(projectTranscriptChrome({
      surface: 'context',
      source: { kind: 'session-reference', form: 'recall', version: 1, references: [] },
    })).toEqual({ voice: 'runtime', lane: 'recall' })
    expect(projectTranscriptChrome({
      surface: 'context',
      source: { kind: 'plugin', plugin: 'im', form: 'relay' },
    })).toEqual({ voice: 'peer', lane: 'wire' })
    expect(projectTranscriptChrome({
      surface: 'context',
      source: { kind: 'skill-catalog', form: 'catalog', entries: [] },
    })).toEqual({ voice: 'runtime', lane: 'brief' })
  })

  it('maps compaction / retry / turn-error to runtime lanes', () => {
    expect(projectTranscriptChrome({ surface: 'compaction' }).lane).toBe('brief')
    expect(projectTranscriptChrome({ surface: 'retry' }).lane).toBe('ops')
    expect(projectTranscriptChrome({ surface: 'turn-error' }).lane).toBe('ops')
  })
})
