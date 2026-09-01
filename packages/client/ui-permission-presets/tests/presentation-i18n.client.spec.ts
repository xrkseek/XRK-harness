import { describe, expect, it } from 'vitest'
import { displayPermissionPreset } from '../src/client/presentation.ts'
import { zh } from '../src/client/locales.ts'

describe('displayPermissionPreset i18n', () => {
  it('maps built-in presets through locale dictionaries', () => {
    const t = (key: 'preset.readOnly' | 'preset.workspaceWrite' | 'preset.fullAccess') => zh[key]
    expect(displayPermissionPreset('read-only', 'read-only', t)).toBe('仅可查看')
    expect(displayPermissionPreset('workspace-write', 'workspace-write', t)).toBe('可写入工作区')
    expect(displayPermissionPreset('danger-full-access', 'danger-full-access', t)).toBe('完全权限')
  })

  it('falls back to English product labels without t', () => {
    expect(displayPermissionPreset('read-only', 'read-only')).toBe('Read Only')
  })
})
