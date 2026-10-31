/**
 * Host elevation for privileged Cordis methods (off-loopback).
 * Planes: API key · optional PIN checker installed by the product Host.
 * The SPA `xrk_operator_ui` cookie is never consulted here.
 */
import { timingSafeEqual } from 'node:crypto'

type OperatorPinElevator = (request: Request) => boolean

let installedPinElevator: OperatorPinElevator | undefined

/**
 * Product Host installs a checker that verifies HttpOnly LAN/WAN PIN digests
 * or a paired device session. Pass `undefined` to clear (tests / dispose).
 */
export function installOperatorPinElevator(
  elevator: OperatorPinElevator | undefined,
): void {
  installedPinElevator = elevator
}

/**
 * Whether the installed PIN elevator accepts this request.
 * Returns false when nothing is installed or the elevator rejects.
 */
export function operatorPinElevatesRequest(request: Request): boolean {
  return installedPinElevator?.(request) === true
}

/**
 * Whether the request carries `XRK_API_KEY` as Bearer or x-api-key.
 * Used when Host has not injected a custom `isOperatorElevated` checker.
 */
export function apiKeyElevatesRequest(request: Request): boolean {
  const expected = typeof process !== 'undefined'
    ? process.env.XRK_API_KEY?.trim()
    : undefined
  if (!expected) return false
  const auth = request.headers.get('authorization')
  const headerKey = request.headers.get('x-api-key')
  const bearer = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : undefined
  const key = bearer ?? headerKey ?? undefined
  if (key === undefined || key.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(key), Buffer.from(expected))
}
