import { describe, expect, it } from 'vitest'
import { abbreviateHomePath } from '../src/path.ts'

describe('abbreviateHomePath', () => {
  it('abbreviates POSIX home roots and leaves Windows paths alone', () => {
    expect(abbreviateHomePath('/home/me', '/home/me')).toBe('~')
    expect(abbreviateHomePath('/home/me/src', '/home/me')).toBe('~/src')
    expect(abbreviateHomePath('/tmp', '/home/me')).toBe('/tmp')
    expect(abbreviateHomePath('C:\\Users\\me\\src', 'C:\\Users\\me')).toBe('C:\\Users\\me\\src')
    expect(abbreviateHomePath('/home/me/src')).toBe('/home/me/src')
  })
})
