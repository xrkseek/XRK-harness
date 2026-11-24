import { describe, expect, it } from 'vitest'
import {
  isHumanOwnedUserMessage,
  projectTranscriptChrome,
} from '../src/client/sessions/transcript-chrome.ts'

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

  it('maps first-class handoff and legacy subagent notice to courier × handoff', () => {
    expect(projectTranscriptChrome({
      surface: 'context',
      source: {
        kind: 'plugin',
        plugin: 'subagent',
        form: 'notice',
        childSessionId: 'sess_child',
      },
    })).toEqual({ voice: 'courier', lane: 'handoff' })
    expect(projectTranscriptChrome({
      surface: 'user',
      source: {
        kind: 'handoff',
        form: 'notice',
        via: 'subagent',
        fromSessionId: 'sess_child',
        label: '发版员',
      },
    })).toEqual({ voice: 'courier', lane: 'handoff' })
  })

  it('does not treat bare plugin form:notice as courier (goals etc.)', () => {
    expect(projectTranscriptChrome({
      surface: 'context',
      source: { kind: 'plugin', plugin: 'goals', form: 'notice' },
    })).toEqual({ voice: 'runtime', lane: 'brief' })
  })

  it('maps legacy subagent-mirror plugin bags to courier×handoff', () => {
    expect(projectTranscriptChrome({
      surface: 'steering',
      source: { kind: 'plugin', plugin: 'subagent-mirror', form: 'notice' },
    })).toEqual({ voice: 'courier', lane: 'handoff' })
  })

  it('maps seat speech to seat / peer voices (never operator)', () => {
    expect(projectTranscriptChrome({
      surface: 'user',
      source: {
        kind: 'seat',
        form: 'speech',
        channel: 'parent',
        fromSessionId: 'sess_mgr',
        label: '经理',
      },
    })).toEqual({ voice: 'seat', lane: 'open' })
    expect(projectTranscriptChrome({
      surface: 'steering',
      source: {
        kind: 'seat',
        form: 'speech',
        channel: 'parent',
        fromSessionId: 'sess_mgr',
      },
    })).toEqual({ voice: 'seat', lane: 'cutin' })
    expect(projectTranscriptChrome({
      surface: 'user',
      source: {
        kind: 'seat',
        form: 'speech',
        channel: 'peer',
        fromSessionId: 'sess_peer',
      },
    })).toEqual({ voice: 'peer', lane: 'wire' })
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

  it('isHumanOwnedUserMessage mirrors protocol human admit only', () => {
    expect(isHumanOwnedUserMessage(undefined)).toBe(true)
    expect(isHumanOwnedUserMessage({ kind: 'user' })).toBe(true)
    expect(isHumanOwnedUserMessage({
      kind: 'seat',
      form: 'speech',
      channel: 'parent',
      fromSessionId: 'sess_mgr',
      label: '经理',
    })).toBe(false)
    expect(isHumanOwnedUserMessage({ kind: 'auto-continue', round: 1 })).toBe(false)
    expect(isHumanOwnedUserMessage({
      kind: 'handoff',
      form: 'notice',
      via: 'subagent',
      fromSessionId: 'sess_child',
    })).toBe(false)
  })
})
