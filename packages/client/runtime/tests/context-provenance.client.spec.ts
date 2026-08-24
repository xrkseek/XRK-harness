/**
 * Context provenance projection: the role and producer name a transcript row
 * shows for one logged non-user message, read from the durable source alone.
 */

import { describe, expect, it } from 'vitest'
import { contextForm, contextProvenance, sessionRecallLabels } from '../src/client/sessions/context-provenance.ts'

describe('contextProvenance', () => {
  it('names a plugin producer by its logged plugin id', () => {
    expect(contextProvenance({ kind: 'plugin', plugin: 'dsh-tool-skill' }))
      .toEqual({ role: 'inject', label: 'dsh-tool-skill' })
  })

  it('names workspace instructions by the files they reconciled, deduplicated in first-seen order', () => {
    expect(contextProvenance({
      kind: 'agent-instructions',
      baseline: true,
      changes: [
        { action: 'set', scope: '.AGENTS.md', path: 'AGENTS.md' },
        { action: 'set', scope: 'subAGENTS.md', path: 'sub/AGENTS.md' },
        { action: 'replace', scope: '.AGENTS.md', path: 'AGENTS.md' },
      ],
    })).toEqual({ role: 'inject', label: 'AGENTS.md, sub/AGENTS.md' })
  })

  it('marks a cross-session snapshot as recall and names the sessions it read', () => {
    expect(contextProvenance({
      kind: 'session-reference',
      version: 1,
      references: [{ sessionId: 's1', label: 'Refactor the loader' }, { sessionId: 's2', label: 'Fix CI' }],
    })).toEqual({ role: 'recall', label: 'Refactor the loader, Fix CI' })
  })

  it('identifies a producer this UI version does not know by its own durable kind', () => {
    expect(contextProvenance({ kind: 'subagent-report', senderSessionId: 'child' }))
      .toEqual({ role: 'inject', label: 'subagent-report' })
  })

  it('falls back to the source kind when the expected name field is unusable', () => {
    // Every arm keeps the kind as its last readable name: a missing, empty, or
    // wrongly-typed name field must not blank the row header.
    expect(contextProvenance({ kind: 'plugin' }).label).toBe('plugin')
    expect(contextProvenance({ kind: 'plugin', plugin: '' }).label).toBe('plugin')
    expect(contextProvenance({ kind: 'plugin', plugin: 7 }).label).toBe('plugin')
    expect(contextProvenance({ kind: 'agent-instructions', changes: [] }).label)
      .toBe('agent-instructions')
    expect(contextProvenance({ kind: 'agent-instructions', changes: 'AGENTS.md' }).label)
      .toBe('agent-instructions')
    expect(contextProvenance({ kind: 'agent-instructions', changes: [{ action: 'set' }, null] }).label)
      .toBe('agent-instructions')
    expect(contextProvenance({ kind: 'session-reference', references: [] }))
      .toEqual({ role: 'recall', label: 'session-reference' })
  })

  it('degrades to an unnamed injection for a source that carries no readable kind', () => {
    const unnamed = { role: 'inject', label: null }
    expect(contextProvenance(null)).toEqual(unnamed)
    expect(contextProvenance(undefined)).toEqual(unnamed)
    expect(contextProvenance('plugin')).toEqual(unnamed)
    expect(contextProvenance([{ kind: 'plugin' }])).toEqual(unnamed)
    expect(contextProvenance({ plugin: 'dsh-tool-skill' })).toEqual(unnamed)
    expect(contextProvenance({ kind: 42 })).toEqual(unnamed)
  })
})

describe('sessionRecallLabels', () => {
  it('returns reference labels for session-reference sources only', () => {
    expect(sessionRecallLabels({
      kind: 'session-reference',
      references: [{ sessionId: 's1', label: 'Refactor the loader' }, { sessionId: 's2', label: 'Fix CI' }],
    })).toEqual(['Refactor the loader', 'Fix CI'])
    expect(sessionRecallLabels({ kind: 'plugin', plugin: 'x' })).toEqual([])
    expect(sessionRecallLabels(null)).toEqual([])
  })
})

describe('contextForm', () => {
  it('reads the form a producer declared', () => {
    expect(contextForm({ kind: 'agent-instructions', form: 'instructions', changes: [] }))
      .toBe('instructions')
    expect(contextForm({ kind: 'skill-catalog', form: 'catalog', entries: [] })).toBe('catalog')
    expect(contextForm({ kind: 'plugin', form: 'snapshot', sections: [] })).toBe('snapshot')
    expect(contextForm({ kind: 'plugin', form: 'notice', summary: 'x' })).toBe('notice')
    expect(contextForm({ kind: 'subagent-report', form: 'relay' })).toBe('relay')
    expect(contextForm({ kind: 'session-reference', form: 'recall' })).toBe('recall')
  })

  it('degrades to the opaque presentation for anything this version does not present', () => {
    // The durable vocabulary may already be wider than this UI version, and a
    // source need not declare a form at all; neither may drop the row.
    expect(contextForm({ kind: 'plugin', plugin: 'dsh-tool-skill' })).toBeNull()
    // A durable vocabulary wider than this UI version still renders.
    expect(contextForm({ kind: 'plugin', form: 'a-later-form' })).toBeNull()
    expect(contextForm({ kind: 'plugin', form: '' })).toBeNull()
    expect(contextForm({ kind: 'plugin', form: 7 })).toBeNull()
    expect(contextForm(null)).toBeNull()
    expect(contextForm('instructions')).toBeNull()
  })
  it('names a skill catalog from its entry names', () => {
    expect(contextProvenance({
      kind: 'skill-catalog',
      form: 'catalog',
      entries: [{ name: 'alpha', description: 'A' }, { name: 'beta', description: 'B' }],
    })).toEqual({ role: 'inject', label: 'alpha, beta' })
    expect(contextProvenance({ kind: 'skill-catalog', form: 'catalog', entries: [] }))
      .toEqual({ role: 'inject', label: 'skill-catalog' })
  })

})
