import { describe, expect, it } from 'vitest'
import {
  fileLanesForClosing, foldFileLanes, lanesFromChangesFiles, mutationsFromToolView, opFromFileDiff,
} from '../src/client/file-lanes.ts'
import type { DeliverablesTurnData } from '../src/client/turn-deliverables.ts'

describe('opFromFileDiff', () => {
  it('classifies create / modify / delete', () => {
    expect(opFromFileDiff({ path: 'a.ts', oldText: null, newText: 'x' })).toBe('create')
    expect(opFromFileDiff({ path: 'a.ts', oldText: 'x', newText: 'y' })).toBe('modify')
    expect(opFromFileDiff({ path: 'a.ts', oldText: 'x', newText: '' })).toBe('delete')
  })
})

describe('foldFileLanes', () => {
  it('last op wins and drops created-then-deleted from created', () => {
    expect(foldFileLanes([
      { seq: 1, path: 'tmp.txt', op: 'create' },
      { seq: 2, path: 'keep.ts', op: 'create' },
      { seq: 3, path: 'tmp.txt', op: 'delete' },
      { seq: 4, path: 'edit.ts', op: 'modify' },
    ])).toEqual({
      created: ['keep.ts'],
      modified: ['edit.ts'],
      deleted: ['tmp.txt'],
    })
  })
})

describe('mutationsFromToolView', () => {
  it('reads diff result views and generic delete', () => {
    expect(mutationsFromToolView({
      card: 'diff',
      title: 'edit',
      diffs: [
        { path: 'new.ts', oldText: null, newText: 'a' },
        { path: 'gone.ts', oldText: 'b', newText: '' },
      ],
    }, 9)).toEqual([
      { seq: 9, path: 'new.ts', op: 'create' },
      { seq: 9, path: 'gone.ts', op: 'delete' },
    ])
    expect(mutationsFromToolView({
      card: 'generic',
      title: 'rm',
      kind: 'delete',
      locations: [{ path: 'x.ts' }],
    }, 2)).toEqual([{ seq: 2, path: 'x.ts', op: 'delete' }])
  })
})

describe('fileLanesForClosing', () => {
  it('uses mutation ops when present', () => {
    const data: DeliverablesTurnData = {
      produced: [
        { seq: 1, path: 'a.ts', op: 'create' },
        { seq: 2, path: 'a.ts', op: 'delete' },
        { seq: 3, path: 'b.ts', op: 'modify' },
      ],
    }
    expect(fileLanesForClosing(data, 10)).toEqual({
      created: [],
      modified: ['b.ts'],
      deleted: ['a.ts'],
    })
  })

  it('falls back to changes summary heuristics', () => {
    expect(lanesFromChangesFiles([
      { path: 'n.ts', display: 'n.ts', added: 3, deleted: 0 },
      { path: 'm.ts', display: 'm.ts', added: 1, deleted: 1 },
      { path: 'd.ts', display: 'd.ts', added: 0, deleted: 2 },
    ])).toEqual({
      created: ['n.ts'],
      modified: ['m.ts'],
      deleted: ['d.ts'],
    })
  })
})
