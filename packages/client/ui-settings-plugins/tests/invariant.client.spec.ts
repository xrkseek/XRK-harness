/** The package's node half: an empty host body and an explained empty invariant companion. */

import { describe, expect, it } from 'vitest'
import { Context } from '@xrkseek/cordis'
import InvariantRegistry from '@xrkseek/xrk-invariants'
import * as PluginConfigInvariant from '@xrkseek/client-ui-settings-plugins/invariant'

describe('invariant companion', () => {
  it('reserves package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(PluginConfigInvariant).await()).resolves.toBeDefined()
  })

  it('has an empty node half', async () => {
    const { apply } = await import('@xrkseek/client-ui-settings-plugins')

    // The host body exists only so the plugin appears in the host cordis.yml;
    // every surface this package ships lives in the browser half.
    apply()

    expect(typeof apply).toBe('function')
  })
})
