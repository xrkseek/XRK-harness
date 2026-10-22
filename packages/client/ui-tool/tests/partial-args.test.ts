import { describe, expect, it } from 'vitest'
import {
  readPartialContentUnits,
  readPartialStringField,
  readPartialStringFields,
} from '../src/client/tool/models/partial-args.ts'

describe('readPartialStringField', () => {
  it('returns undefined until the string value closes', () => {
    expect(readPartialStringField('{"description":"hel', 'description')).toBeUndefined()
    expect(readPartialStringField('{"description":"hello"', 'description')).toBe('hello')
  });

  it('reads file_path from an unclosed object', () => {
    const raw = '{"file_path":"/tmp/a.ts","content":"still open'
    expect(readPartialStringField(raw, 'file_path')).toBe('/tmp/a.ts')
    expect(readPartialStringField(raw, 'content')).toBeUndefined()
  })

  it('unescapes closed JSON string values', () => {
    expect(readPartialStringField('{"path":"a\\\\b"}', 'path')).toBe('a\\b')
  })
})

describe('readPartialStringFields', () => {
  it('prefers the first closed key', () => {
    const raw = '{"command":"ls","description":"list"}'
    expect(readPartialStringFields(raw, ['description', 'command'])).toBe('list')
  })
})

describe('readPartialContentUnits', () => {
  it('counts 1024-char units while content is still open', () => {
    const body = 'x'.repeat(2050)
    expect(readPartialContentUnits(`{"content":"${body}`)).toBe(3)
  })
})
