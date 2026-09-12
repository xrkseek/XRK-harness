import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconChevronDownOutline14, Menu, Tooltip, type MenuItem,
} from '@xrkseek/client-ui-primitives'
import type { ObservableSnapshot } from '@xrkseek/client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type {} from '@xrkseek/client-ui-conversation/client'
import type { ConnectionHandle } from '@xrkseek/client-connection/client'
import { NS, type OpenInAppKey } from './locales.ts'
import css from './OpenInAppAction.module.css'

/** Browser operations and state injected into the Session Header contribution. */
export interface OpenInAppActionInjected {
  hooks: {
    openInAppApps: ObservableSnapshot<readonly string[] | null>
    openInAppChoice: ObservableSnapshot<string>
    hostDescription: ConnectionHandle['hostDescription']
  }
  isLoopback: boolean
  launch: (appId: string, path: string) => Promise<void>
  choose: (appId: string) => void
}

/** Full props for the Session-header open-in-app split button. */
export type OpenInAppActionProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<OpenInAppActionInjected>

/**
 * Label keys per catalog id: the browser renders only ids it can name.
 */
const APP_LABEL_KEY: Record<string, OpenInAppKey | undefined> = {
  finder: 'app.finder',
  explorer: 'app.explorer',
  filemanager: 'app.filemanager',
  cursor: 'app.cursor',
  vscode: 'app.vscode',
  terminal: 'app.terminal',
  windowsterminal: 'app.windowsterminal',
  iterm: 'app.iterm',
  gnometerminal: 'app.gnometerminal',
}

const BUSY_DRESS_DELAY_MS = 250

/**
 * Session-header split button: open the session workspace in a probed app.
 * Renders nothing until Face reported apps, the session has a cwd, and the
 * page is loopback with `canOpenPath`.
 */
export function OpenInAppAction(props: OpenInAppActionProps): ReactNode {
  const {
    sessionId, useSessions, useOpenInAppApps, useOpenInAppChoice,
    useHostDescription, isLoopback, t,
  } = props
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const available = useOpenInAppApps(apps => apps)
  const choice = useOpenInAppChoice(id => id)
  const canOpenPath = useHostDescription(d => d?.canOpenPath === true)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'busy' | 'error'>('idle')
  const inFlight = useRef(false)
  const busyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => {
    clearTimeout(busyTimer.current)
    clearTimeout(errorTimer.current)
  }, [])

  if (!isLoopback || !canOpenPath) return null

  const apps = (available ?? [])
    .map(id => ({ id, labelKey: APP_LABEL_KEY[id] }))
    .filter((entry): entry is { id: string; labelKey: OpenInAppKey } => entry.labelKey !== undefined)
  const currentEntry = apps.find(entry => entry.id === choice) ?? apps[0]
  if (currentEntry === undefined || cwd === undefined || cwd === '') return null

  const current = currentEntry.id
  const currentLabel = t(currentEntry.labelKey)
  const title = phase === 'error' ? t('open.error') : t('open.title', { app: currentLabel })

  const launch = (appId: string): void => {
    if (inFlight.current) return
    inFlight.current = true
    clearTimeout(errorTimer.current)
    clearTimeout(busyTimer.current)
    busyTimer.current = setTimeout(() => { setPhase('busy') }, BUSY_DRESS_DELAY_MS)
    props.launch(appId, cwd).then(() => {
      inFlight.current = false
      clearTimeout(busyTimer.current)
      setPhase('idle')
    }, () => {
      inFlight.current = false
      clearTimeout(busyTimer.current)
      setPhase('error')
      clearTimeout(errorTimer.current)
      errorTimer.current = setTimeout(() => { setPhase('idle') }, 2_000)
    })
  }

  const items: MenuItem[] = apps.map(entry => ({
    id: entry.id,
    label: t(entry.labelKey),
  }))

  return (
    <Menu
      open={open}
      align="end"
      dense
      portal
      onClose={() => { setOpen(false) }}
      items={items}
      selectedId={current}
      onSelect={(id) => {
        setOpen(false)
        if (inFlight.current) return
        props.choose(id)
        launch(id)
      }}
      anchor={(
        <div className={css.split} data-state={phase}>
          <Tooltip label={phase === 'error' ? t('open.error') : t('open.tooltip')} side="bottom">
            <button
              type="button"
              className={css.main}
              disabled={phase === 'busy'}
              aria-label={title}
              onClick={() => { launch(current) }}
            >
              <span className={css.label}>{currentLabel}</span>
            </button>
          </Tooltip>
          <button
            type="button"
            className={css.chevron}
            aria-expanded={open}
            aria-haspopup="menu"
            title={t('menu.toggle')}
            aria-label={t('menu.toggle')}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconChevronDownOutline14 size={11} />
          </button>
        </div>
      )}
    />
  )
}
