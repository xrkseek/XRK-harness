/**
 * Cross-plugin hook: Agent Preset binds the Creator draft starter; Plugins
 * settings (and peers) can invoke it without importing the preset package.
 */

let handler: (() => void) | undefined

/** Bind the live Creator draft starter; returns an unbind. */
export function bindCreatorDraftStarter(fn: () => void): () => void {
  handler = fn
  return () => {
    if (handler === fn) handler = undefined
  }
}

/** Invoke the bound starter when present. */
export function startBoundCreatorDraft(): boolean {
  if (handler === undefined) return false
  handler()
  return true
}
