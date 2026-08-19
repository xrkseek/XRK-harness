/**
 * Package-owned invariant companion for `@xrkseek/client-ui-sidebar`.
 * @module @xrkseek/client-ui-sidebar/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@xrkseek/cordis'
import type { InvariantInstaller } from '@xrkseek/xrk-invariants'

const PACKAGE_NAME = '@xrkseek/client-ui-sidebar'

/** Cordis companion plugin name. */
export const name = 'client-ui-sidebar-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a pure-consumer plugin deriving its rows in-component
 * from the standard useSessions delivery — it emits no cordis events and owns
 * no cross-plugin mutable state; derivation and interaction behavior are
 * asserted directly by this package's tree/component specs.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
