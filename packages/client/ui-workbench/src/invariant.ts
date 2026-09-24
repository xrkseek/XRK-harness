/**
 * Package-owned invariant companion for `@xrkseek/client-ui-workbench`.
 * @module @xrkseek/client-ui-workbench/invariant
 */

import type { Context } from '@xrkseek/cordis'
import type { InvariantInstaller } from '@xrkseek/xrk-invariants'

const PACKAGE_NAME = '@xrkseek/client-ui-workbench'

/** Cordis companion plugin name. */
export const name = 'client-ui-workbench-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: overlay registration is exercised by package tests. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
