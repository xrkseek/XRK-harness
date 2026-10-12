/** Wire `args` packing for Face Typert remotes (no generated codecs). */

export type FaceArgSpec = readonly string[] | 'args'

/**
 * DSH session-controller Remote names → Face dotted methods.
 * Keeps community `ctx.remote.session.*` call sites working on Face wire.
 */
const SESSION_METHOD_ALIASES: Readonly<Record<string, string>> = {
  modelCatalog: 'session.models',
  page: 'session.history',
}

/**
 * Face RPC path for one Remote call.
 * Session handlers are dotted (`session.list`); other remotes use slash
 * (`commands/list`). Community clients inject `remote.session`.
 */
export function faceRemoteEndpoint(namespace: string, method: string): string {
  if (namespace === 'session') {
    return SESSION_METHOD_ALIASES[method] ?? `${namespace}.${method}`
  }
  return `${namespace}/${method}`
}

/**
 * Pack positional Remote arguments into the Face unary `{ args }` object.
 * `'args'` means the first business argument is already the wire bag
 * (messageFeedback). A trailing `AbortSignal` is dropped.
 */
export function packRemoteArgs(
  spec: FaceArgSpec,
  values: readonly unknown[],
): Record<string, unknown> {
  const args: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  const last = values[values.length - 1]
  const business = last instanceof AbortSignal ? values.slice(0, -1) : values
  if (spec === 'args') {
    const bag = business[0]
    if (isPlainObject(bag)) Object.assign(args, bag)
    return args
  }
  spec.forEach((wire, index) => {
    const value = business[index]
    if (value !== undefined) args[wire] = value
  })
  return args
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
