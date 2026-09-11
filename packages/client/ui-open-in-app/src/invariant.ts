/**
 * Package-owned invariant companion for `@xrkseek/client-ui-open-in-app`.
 * @module @xrkseek/client-ui-open-in-app/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@xrkseek/cordis'
import type { InvariantInstaller } from '@xrkseek/xrk-invariants'

const PACKAGE_NAME = '@xrkseek/client-ui-open-in-app'

/** Cordis companion plugin name. */
export const name = 'client-ui-open-in-app-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant beyond HMR-safe slot disposal. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
