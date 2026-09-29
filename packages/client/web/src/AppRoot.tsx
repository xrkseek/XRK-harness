/**
 * Shell root: boot loading page → (boot settled) → real UI in one switch.
 * Pure kernel component with zero plugin dependencies — before settled it may
 * only rely on itself (the fail-loud presentation must not depend on the
 * system whose failure it reports; the status/signal stores are kernel-own,
 * shell self-sufficiency rule); the real UI is produced by the
 * app-shell entry once every entry is active. A failed boot keeps the
 * loading page, lists the per-entry fiber states and the sweep report (fail
 * loud, no partial UI).
 *
 * Product readiness (Host Fetch + connection + session list) is folded into
 * `settled` by the boot kernel — this page stays up so the empty shell never
 * flashes. Desktop window chrome rides the splash (BootWindowChrome) so the
 * frameless shell stays operable before AppFrame mounts.
 */
import { useLayoutEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import {
  bootFailedTitle,
  bootPluginHint,
  resolveBootLang,
  type BootLang,
} from './boot-hints.ts'
import { BootWindowChrome } from './BootWindowChrome.tsx'
import { clearBooting, stampBooting } from './boot-stamp.ts'
import type { KernelSignal, LoaderStatus } from './loader-status.ts'
import css from './AppRoot.module.css'

/** AppRoot props: settled signal, fiber-state projection feed, boot failure report, deferred real-UI factory. */
export interface AppRootProps {
  /** True once plugins + Host/session list are ready; the boot closure flips it. */
  settled: KernelSignal<boolean>
  /** Per-entry fiber-state projection store (drives loading/failed rendering). */
  status: KernelSignal<LoaderStatus>
  /** Boot failure report (the settle rejection message); undefined while loading or after success. */
  error: KernelSignal<string | undefined>
  /**
   * Progressive boot hint under the spinner. Defaults to a lang-aware
   * "Loading plugins…" (locale plugins may still be activating).
   */
  hint?: KernelSignal<string>
  /** Splash language (zh/en); defaults to navigator / Desktop resolution. */
  lang?: KernelSignal<BootLang>
  /** Builds the real UI; called only after settled. */
  renderApp: () => ReactNode
}

/** Boot gate: loading page until the boot settles; failures stay here. */
export function AppRoot(props: AppRootProps) {
  const settled = useSyncExternalStore(props.settled.subscribe, props.settled.getSnapshot)
  const status = useSyncExternalStore(props.status.subscribe, props.status.getSnapshot)
  const error = useSyncExternalStore(props.error.subscribe, props.error.getSnapshot)
  const lang = useSyncExternalStore(
    props.lang?.subscribe ?? (() => () => {}),
    () => props.lang?.getSnapshot() ?? resolveBootLang(),
  )
  const hint = useSyncExternalStore(
    props.hint?.subscribe ?? (() => () => {}),
    () => props.hint?.getSnapshot() ?? bootPluginHint({}, lang),
  )
  const failed = Object.entries(status).filter(([, s]) => s === 'failed')
  const loud = error !== undefined || failed.length > 0

  // useLayoutEffect: stamp before browser paint so body-portaled FABs never
  // flash; boot.tsx also stamps before plugin fibers for the same reason.
  useLayoutEffect(() => {
    if (settled) {
      clearBooting()
      return
    }
    stampBooting(lang)
    return () => { clearBooting() }
  }, [settled, lang])

  if (settled) return <>{props.renderApp()}</>

  return (
    <div className={css.boot} role="status" aria-live="polite" aria-busy={!loud || undefined}>
      <BootWindowChrome lang={lang} />
      <div className={css.ambient} aria-hidden />
      <div className={css.card}>
        <div className={css.wordmark}>HARNESS</div>
        {!loud
          ? (
            <>
              <div className={css.spinnerWrap} aria-hidden>
                <div className={css.spinnerRing} />
                <div className={css.spinnerCore} />
              </div>
              <div key={hint} className={css.hint}>{hint}</div>
            </>
          )
          : (
            <div className={css.failed}>
              <div className={css.failedTitle}>{bootFailedTitle(lang)}</div>
              {failed.map(([id]) => <div key={id} className={css.failedItem}>{id}</div>)}
              {error !== undefined && <div className={css.failedItem}>{error}</div>}
            </div>
          )}
      </div>
    </div>
  )
}
