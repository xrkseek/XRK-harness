/**
 * Host API-key elevation for privileged Cordis methods (off-loopback).
 */
import { timingSafeEqual } from 'node:crypto'

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
