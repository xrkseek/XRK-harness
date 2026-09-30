import { describe, expect, it } from 'vitest'
import {
  formatAttachmentSummary,
  isAttachmentAddress,
  normalizeAttachmentId,
  resolveWorkspacePath,
} from '../src/client/workspaces/path.ts'

describe('isAttachmentAddress', () => {
  it('recognizes sha256 and attachment: spellings', () => {
    expect(isAttachmentAddress('sha256:abc')).toBe(true)
    expect(isAttachmentAddress('sha256:DEADBEEF')).toBe(true)
    expect(isAttachmentAddress('attachment:sha256:abc')).toBe(true)
    expect(isAttachmentAddress('  sha256:abc  ')).toBe(true)
  })

  it('rejects workspace paths and empty attachment:', () => {
    expect(isAttachmentAddress('src/a.ts')).toBe(false)
    expect(isAttachmentAddress('/proj/a.png')).toBe(false)
    expect(isAttachmentAddress('attachment:')).toBe(false)
    expect(isAttachmentAddress('')).toBe(false)
  })
})

describe('formatAttachmentSummary', () => {
  it('shortens long digests and normalizes attachment: prefixes', () => {
    const id = 'sha256:614b7f3194c587139769f70801d2cb8578192c1a3dc704c244f82013c379ac16'
    expect(formatAttachmentSummary(id)).toBe('sha256:614b7f…ac16')
    expect(formatAttachmentSummary(`attachment:${id}`)).toBe('sha256:614b7f…ac16')
    expect(normalizeAttachmentId(`attachment:${id}`)).toBe(id)
    expect(formatAttachmentSummary('sha256:abcdef01234567')).toBe('sha256:abcdef01234567')
  })
})

describe('resolveWorkspacePath', () => {
  it('maps . to the workspace root', () => {
    expect(resolveWorkspacePath('/proj', '.')).toBe('/proj')
    expect(resolveWorkspacePath('C:\\proj', '.')).toBe('C:\\proj')
  })

  it('joins relative segments', () => {
    expect(resolveWorkspacePath('/proj', 'src/a.ts')).toBe('/proj/src/a.ts')
  })

  it('keeps Windows drive-root join qualified', () => {
    expect(resolveWorkspacePath('C:\\', 'src\\a.ts')).toBe('C:\\src\\a.ts')
    expect(resolveWorkspacePath('C:\\work\\', 'src\\a.ts')).toBe('C:\\work\\src\\a.ts')
    expect(resolveWorkspacePath('C:/work/', 'src/a.ts')).toBe('C:/work/src/a.ts')
    expect(resolveWorkspacePath('C:\\', '.')).toBe('C:\\')
  })

  it('keeps absolute paths', () => {
    expect(resolveWorkspacePath('/proj', '/abs/x')).toBe('/abs/x')
  })

  it('does not join attachment ids under cwd', () => {
    expect(resolveWorkspacePath('/proj', 'sha256:abc')).toBe('sha256:abc')
    expect(resolveWorkspacePath('/proj', 'attachment:sha256:abc')).toBe('attachment:sha256:abc')
  })
})
