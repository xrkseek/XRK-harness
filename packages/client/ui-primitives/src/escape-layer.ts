/**
 * Last-opened Escape consumer wins. Modal (and similar) push on open / pop on
 * close; Escape handlers no-op unless they own the top token — so nested
 * dialogs do not depend on document listener registration order.
 */

const stack: symbol[] = []

/** Push a layer; call {@link popEscapeLayer} with the same token on dispose. */
export function pushEscapeLayer(): symbol {
  const id = Symbol('escape-layer')
  stack.push(id)
  return id
}

/** Drop one layer (idempotent if already popped). */
export function popEscapeLayer(id: symbol): void {
  const at = stack.lastIndexOf(id)
  if (at >= 0) stack.splice(at, 1)
}

/** True when this token is the innermost live Escape consumer. */
export function isTopEscapeLayer(id: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id
}
