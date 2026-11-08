import { describe, expect, it } from 'vitest'
import { notifySessionCompleted } from '../src/client/sessions/os-notify.ts'
import { getOsNotifyPolicy, setOsNotifyPolicy } from '../src/client/sessions/os-notify-policy.ts'

describe('os-notify policy', () => {
  it('gates notifySessionCompleted on enabled', () => {
    setOsNotifyPolicy({ enabled: false, focusPolicy: 'always' })
    let fired = 0
    notifySessionCompleted({
      title: 't',
      body: 'b',
      isFocused: () => false,
      notify: () => { fired += 1 },
    })
    expect(fired).toBe(0)
    expect(getOsNotifyPolicy().enabled).toBe(false)

    setOsNotifyPolicy({ enabled: true, focusPolicy: 'unfocused' })
    notifySessionCompleted({
      title: 't',
      body: 'b',
      isFocused: () => false,
      notify: () => { fired += 1 },
    })
    expect(fired).toBe(1)
  })
})
