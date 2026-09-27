/**
 * Package-owned invariant companion for `@xrkseek/client-ui-schedule`.
 * @module @xrkseek/client-ui-schedule/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@xrkseek/cordis'
import type { InvariantInstaller } from '@xrkseek/xrk-invariants'

const PACKAGE_NAME = '@xrkseek/client-ui-schedule'

/** Cordis companion plugin name. */
export const name = 'client-ui-schedule-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * The schedule directory is read-only: it projects the Host cron catalog over
 * HTTP and never mutates state, so it owns no long-lived changes worth an
 * invariant. Registration still reserves ownership for HMR-safety bookkeeping.
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