/**
 * Package-owned invariant companion for `@xrkseek/xrk-session-reference`.
 * @module @xrkseek/xrk-session-reference/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@xrkseek/cordis'
import type { InvariantInstaller } from '@xrkseek/xrk-invariants'

const PACKAGE_NAME = '@xrkseek/xrk-session-reference'

/** Cordis companion plugin name. */
export const name = 'session-reference-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: preparation returns immutable per-call snapshots validated while they are
 * built, and the agent/session layers own durable context admission, freezing, and replay.
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
