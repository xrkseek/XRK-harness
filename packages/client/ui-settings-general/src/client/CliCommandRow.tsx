/**
 * Desktop General row: keep the bundled `xrkh` first on the user PATH.
 * Hidden in the browser (no `xrkDesktop.cliCommand`).
 */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { Switch } from '@xrkseek/client-ui-primitives'
import css from './SidebarAgentPushRows.module.css'

interface CliCommandState {
  readonly linked: boolean
  readonly binDir: string
}

interface CliCommandBridge {
  get(): Promise<CliCommandState>
  set(linked: boolean): Promise<CliCommandState>
}

function cliCommandBridge(): CliCommandBridge | undefined {
  const root = (globalThis as { xrkDesktop?: { cliCommand?: CliCommandBridge } }).xrkDesktop
  if (root?.cliCommand?.get === undefined || root.cliCommand.set === undefined) return undefined
  return root.cliCommand
}

export type CliCommandRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings'>

/** Switch for the desktop-owned global `xrkh` shim. */
export function CliCommandRow({ t }: CliCommandRowProps) {
  const bridge = cliCommandBridge()
  const [linked, setLinked] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!bridge) return
    let alive = true
    void bridge.get().then((state) => {
      if (!alive) return
      setLinked(state.linked)
      setReady(true)
    }).catch(() => {
      if (alive) setError(true)
    })
    return () => {
      alive = false
    }
  }, [bridge])

  if (!bridge || !ready) return null

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('cliCommand.title')}</div>
        <div className={css.desc}>
          {error ? t('cliCommand.saveFailed') : t('cliCommand.description')}
        </div>
      </div>
      <Switch
        checked={linked}
        disabled={error}
        aria-label={t('cliCommand.title')}
        onCheckedChange={(next) => {
          const previous = linked
          setLinked(next)
          setError(false)
          void bridge.set(next).then(
            (state) => { setLinked(state.linked) },
            () => {
              setLinked(previous)
              setError(true)
            },
          )
        }}
      />
    </div>
  )
}
