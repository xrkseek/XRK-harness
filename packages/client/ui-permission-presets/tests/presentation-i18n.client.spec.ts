import { describe, expect, it } from 'vitest'
import {
  AUTO_REVIEW_PRESET, displayPermissionPreset, isAutoPreset, isFullAccessPreset,
} from '../src/client/presentation.ts'
import { accessZh, zh } from '../src/client/locales.ts'

describe('displayPermissionPreset i18n', () => {
  it('maps built-in presets through locale dictionaries', () => {
    const t = (key: 'preset.readOnly' | 'preset.workspaceWrite' | 'preset.fullAccess' | 'preset.auto') => zh[key]
    expect(displayPermissionPreset('read-only', 'read-only', t)).toBe('仅可查看')
    expect(displayPermissionPreset('workspace-write', 'workspace-write', t)).toBe('可写入工作区')
    expect(displayPermissionPreset('danger-full-access', 'danger-full-access', t)).toBe('完全权限')
    expect(displayPermissionPreset('auto', 'auto', t)).toBe('自动审查')
  })

  it('falls back to English product labels without t', () => {
    expect(displayPermissionPreset('read-only', 'read-only')).toBe('Read Only')
    expect(displayPermissionPreset('auto', 'auto')).toBe('Auto review')
  })

  it('identifies Auto review and ships DSH-aligned risk copy', () => {
    expect(isAutoPreset(AUTO_REVIEW_PRESET)).toBe(true)
    expect(isFullAccessPreset(AUTO_REVIEW_PRESET)).toBe(false)
    expect(accessZh['auto.badge']).toBe('EXP')
    expect(accessZh['auto.confirm.title']).toContain('自动审查')
  })
})
