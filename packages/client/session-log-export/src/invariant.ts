/**
 * Package-owned invariant companion for `@xrkseek/client-session-log-export`.
 * @module @xrkseek/client-session-log-export/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@xrkseek/cordis'
import type { InvariantInstaller } from '@xrkseek/xrk-invariants'

const PACKAGE_NAME = '@xrkseek/client-session-log-export'

/** Cordis companion plugin name. */
export const name = 'client-session-log-export-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin owns one header action + modal whose
 * disposal the HMR-safety path proves, and download state is session-local.
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
