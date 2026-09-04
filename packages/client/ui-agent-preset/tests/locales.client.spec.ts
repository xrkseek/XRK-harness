/** Web-localized copy for the six shipped tool surfaces. */

import { describe, expect, it } from 'vitest'
import { en, presetDisplayText, zh } from '../src/client/locales.ts'

const translate = (bundle: typeof en) => (key: keyof typeof en): string => bundle[key]

describe('preset display copy', () => {
  it.each([
    ['minimal', 'presetMinimalName', 'presetMinimalDescription'],
    ['shell', 'presetShellName', 'presetShellDescription'],
    ['frugal', 'presetFrugalName', 'presetFrugalDescription'],
    ['plan', 'presetPlanName', 'presetPlanDescription'],
    ['shallow', 'presetShallowName', 'presetShallowDescription'],
    ['harness', 'presetHarnessName', 'presetHarnessDescription'],
  ] as const)('localizes the shipped %s preset in English and Chinese', (id, nameKey, descriptionKey) => {
    const preset = { id, trust: 'system' as const, name: 'file name', description: 'file description' }

    expect(presetDisplayText(preset, translate(en)))
      .toEqual({ name: en[nameKey], description: en[descriptionKey] })
    expect(presetDisplayText(preset, translate(zh)))
      .toEqual({ name: zh[nameKey], description: zh[descriptionKey] })
  })

  it('keeps Face/file metadata for unknown or user presets', () => {
    const fileCopy = { name: '我的标准', description: '团队自己的 preset。' }

    expect(presetDisplayText({ id: 'unknown-system', trust: 'system', ...fileCopy }, translate(en)))
      .toEqual(fileCopy)
    expect(presetDisplayText({ id: 'deployment-extra', trust: 'system', ...fileCopy }, translate(en)))
      .toEqual(fileCopy)
    expect(presetDisplayText({ id: 'bare', trust: 'user' }, translate(en)))
      .toEqual({ name: 'bare' })
  })
})
