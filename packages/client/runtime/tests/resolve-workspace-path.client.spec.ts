import { describe, expect, it } from 'vitest'
import { resolveWorkspacePath } from '../src/client/workspaces/path.ts'

describe('resolveWorkspacePath', () => {
  it('maps . to the workspace root', () => {
    expect(resolveWorkspacePath('/proj', '.')).toBe('/proj')
    expect(resolveWorkspacePath('C:\\proj', '.')).toBe('C:\\proj')
  })

  it('joins relative segments', () => {
    expect(resolveWorkspacePath('/proj', 'src/a.ts')).toBe('/proj/src/a.ts')
  })

  it('keeps absolute paths', () => {
    expect(resolveWorkspacePath('/proj', '/abs/x')).toBe('/abs/x')
  })
})
