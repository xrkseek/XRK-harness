/**
 * Push "any live agent work" into Desktop's sleep inhibitor (Codex
 * `prevent_idle_sleep`). No-ops in the browser / older bridges.
 *
 * Keep the machine awake while a session turn, continuable child, or
 * background job is still live — screen-off should not suspend mid-job.
 */

type PreventIdleSleepBridge = {
  setTurnRunning(running: boolean): Promise<unknown>
}

/** Last value successfully handed to the bridge (or in flight). */
let lastTurnRunning: boolean | undefined

function preventIdleSleepBridge(): PreventIdleSleepBridge | undefined {
  const root = (globalThis as {
    xrkDesktop?: { preventIdleSleep?: PreventIdleSleepBridge }
  }).xrkDesktop
  return root?.preventIdleSleep
}

/**
 * Sync Desktop power assertion with whether any listed session / child / job
 * is still live. Dedupes identical values so list churn does not spam IPC.
 *
 * When the bridge is missing (preload not mounted yet), clear the dedupe bit
 * so the next projection after mount still pushes the live value.
 */
export function syncDesktopPreventIdleSleepTurnRunning(
  anyRunning: boolean,
): void {
  const bridge = preventIdleSleepBridge()
  if (bridge === undefined) {
    lastTurnRunning = undefined
    return
  }
  if (lastTurnRunning === anyRunning) return
  lastTurnRunning = anyRunning
  void bridge.setTurnRunning(anyRunning).catch(() => {
    /* bridge may vanish mid-quit — allow a later projection to retry */
    lastTurnRunning = undefined
  })
}

/** Test helper: clear the last-pushed bit. */
export function resetDesktopPreventIdleSleepTurnRunningForTests(): void {
  lastTurnRunning = undefined
}
