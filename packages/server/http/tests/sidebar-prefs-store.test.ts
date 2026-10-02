import { describe, expect, it } from 'vitest'
import { SIDEBAR_PREFS_DEFAULT } from '../src/sidebar/sidebar-prefs-store.js'

describe('SIDEBAR_PREFS_DEFAULT', () => {
  it('does not auto-open a bottom terminal on first expand', () => {
    expect(SIDEBAR_PREFS_DEFAULT.bottomPanelAutoTerminal).toBe(false)
  })
})
