/** Wire `args` packing for Face Typert remotes (no generated codecs). */

export type FaceArgSpec = readonly string[] | 'args'

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
