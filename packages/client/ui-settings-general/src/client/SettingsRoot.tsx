/**

 * Settings shell root: the sidebar-foot trigger row plus the centered modal

 * panel (figma 501:29947, 1080x700) with the section nav rail. The shell is

 * a pure composition face — every piece of text (trigger label, panel title,

 * close label, sections) arrives from registrants through slots; accessible

 * names resolve to that content (trigger: its own text; dialog:

 * aria-labelledby the title node; close: visually-hidden slot text). Modal

 * open state and the active section id are component-local viewing state;

 * the onboarding coordinator mounts exactly one ordered registrant while the

 * sessions-derived empty-Hero fact is active. Visible dialog chrome belongs

 * to the step, so a mounted-but-deciding step paints nothing here.

 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import type { RefObject } from 'react'

import { createPortal } from 'react-dom'

import clsx from 'clsx'

import {

  ConnectionIndicator,

  IconAgentPresetOutline16, IconCloseOutline16, IconDataOutline16,

  IconPersonalizationOutline16, IconSettingsOutline16,

} from '@xrkseek/client-ui-primitives'

import type { ConnectionIndicatorState } from '@xrkseek/client-ui-primitives'

import type { SettingsRootComponentProps, SettingsSectionRow } from './shell-contract.ts'

import css from './SettingsRoot.module.css'



const RECOVERY_CONFIRMATION_MS = 2_000



/** Nav glyph by section id; unknown ids fall back to the settings gear. */

function navIcon(id: string) {

  if (id === 'models') return <IconDataOutline16 className={css.navIcon} size={16} />

  if (id === 'agent-presets') return <IconAgentPresetOutline16 className={css.navIcon} size={16} />

  if (id === 'plugins') return <IconPersonalizationOutline16 className={css.navIcon} size={16} />

  return <IconSettingsOutline16 className={css.navIcon} size={16} />

}



type PanelProps = {

  rows: readonly SettingsSectionRow[]

  renderSlot: SettingsRootComponentProps['renderSlot']

  activeId: string | undefined

  onSelect: (id: string) => void

  onClose: () => void

  /** Sidebar trigger — focus returns here when the panel unmounts. */

  openerRef: RefObject<HTMLElement | null>

}



/**

 * The modal layer: full-viewport mask + centered panel. Close paths: the

 * header button, a mask click, and document-level Escape (mounted only while

 * open, so the listener lifetime is the panel's). Focus enters on the close

 * control and returns to the opener on unmount (same restore contract as

 * ImageLightbox).

 */

function SettingsPanel({ rows, renderSlot, activeId, onSelect, onClose, openerRef }: PanelProps) {

  // Entries can unmount underneath the requested id, so the render-time

  // projection falls back to the first row when the id is gone.

  const active = rows.find(r => r.id === activeId)?.id ?? rows[0]?.id

  const titleId = useId()

  const closeButton = useRef<HTMLButtonElement | null>(null)

  const navListRef = useRef<HTMLDivElement | null>(null)



  useEffect(() => {

    closeButton.current?.focus()

    const onKeyDown = (e: KeyboardEvent) => {

      if (e.key === 'Escape') onClose()

    }

    document.addEventListener('keydown', onKeyDown)

    return () => {

      document.removeEventListener('keydown', onKeyDown)

      openerRef.current?.focus()

    }

  }, [onClose, openerRef])



  // Keep the active section tab in view when the phone nav scroller overflows.

  useEffect(() => {

    const list = navListRef.current

    if (list === null || active === undefined) return

    const cell = list.querySelector<HTMLElement>('[aria-current="true"]')

    if (cell === null || typeof cell.scrollIntoView !== 'function') return

    const reduce = typeof matchMedia === 'function'

      && matchMedia('(prefers-reduced-motion: reduce)').matches

    cell.scrollIntoView({

      inline: 'nearest',

      block: 'nearest',

      behavior: reduce ? 'auto' : 'smooth',

    })

  }, [active])



  // Portal to body: the settings trigger lives in the sidebar foot, and phone

  // AppFrame draws the drawer with `transform`, which would otherwise become

  // the containing block for `position: fixed` and crush the panel to the

  // drawer width (~280px). Same escape hatch as Modal / ImageLightbox.

  return createPortal((

    <div className={css.overlay} role="presentation">

      <div className={css.mask} aria-hidden="true" onClick={onClose} />

      <div className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>

        <nav className={css.nav}>

          <div className={css.navTitle} id={titleId}>{renderSlot('settings.header', {})}</div>

          <div ref={navListRef} className={css.navList}>

            {rows.map(row => (

              <button

                key={row.id}

                type="button"

                className={clsx(css.navCell, row.id === active && css.active)}

                aria-current={row.id === active ? 'true' : undefined}

                onClick={() => { onSelect(row.id) }}

              >

                {navIcon(row.id)}

                <span className={css.navLabel}>{row.label}</span>

              </button>

            ))}

          </div>

        </nav>

        <div className={css.content}>

          <div className={css.header}>

            <div className={css.actions}>{renderSlot('settings.action', {})}</div>

            <button ref={closeButton} type="button" className={css.close} onClick={onClose}>

              <IconCloseOutline16 size={14} />

              <span className={css.hiddenLabel}>{renderSlot('settings.close', {})}</span>

            </button>

          </div>

          <div className={css.options}>

            {active !== undefined && renderSlot('settings.section', { close: onClose }, { only: active })}

          </div>

        </div>

      </div>

    </div>

  ), document.body)

}



/**

 * Render the settings trigger and panel.

 * @param props - composed slot props (contract/slots.ts).

 * @returns the settings shell element tree.

 */

export function SettingsRoot(props: SettingsRootComponentProps) {

  const {

    wide, reconnect, useConnectionState, useSections, useOnboardingSteps, useSessions, renderSlot, t,

  } = props

  const [open, setOpen] = useState(false)

  const [activeId, setActiveId] = useState<string | undefined>(undefined)

  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())

  const [showRecovery, setShowRecovery] = useState(false)

  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const close = useCallback(() => {

    setOpen(false)

    setActiveId(undefined)

  }, [])

  const openSection = useCallback((id: string) => {

    setActiveId(id)

    setOpen(true)

  }, [])



  // The ledger tick keeps the nav rows fresh: registrants re-register with

  // freshly localized text on locale change, and the trigger/header/close

  // seats re-render through their own outlets' subscriptions.

  const rows = useSections(s => s)

  const connectionState = useConnectionState(state => state)

  const previousConnectionState = useRef(connectionState)

  const onboardingSteps = useOnboardingSteps(s => s)

  const onboardingActive = useSessions(state =>

    state.phase === 'ready'

    && (state.current === undefined || state.byId[state.current]?.blank === true))

  const onboardingStep = onboardingActive

    ? onboardingSteps.find(step => !completedOnboarding.has(step.id))

    : undefined



  useEffect(() => {

    if (onboardingActive) return

    setCompletedOnboarding(new Set())

  }, [onboardingActive])



  // Flash a brief recovered confirmation after an outage clears (DSH alpha.2).

  useLayoutEffect(() => {

    const previous = previousConnectionState.current

    previousConnectionState.current = connectionState

    if (connectionState !== 'connected') {

      setShowRecovery(false)

      return

    }

    if (previous !== 'reconnecting') return

    setShowRecovery(true)

    const timeout = window.setTimeout(() => { setShowRecovery(false) }, RECOVERY_CONFIRMATION_MS)

    return () => { window.clearTimeout(timeout) }

  }, [connectionState])



  const completeOnboardingStep = useCallback((id: string) => {

    setCompletedOnboarding((previous) => {

      if (previous.has(id)) return previous

      return new Set([...previous, id])

    })

  }, [])



  // Wire state is connected | reconnecting; map outage → connecting chrome.

  let connectionIndicator: ConnectionIndicatorState | undefined

  if (connectionState === 'reconnecting') {

    connectionIndicator = 'connecting'

  } else if (showRecovery) {

    connectionIndicator = 'recovered'

  }



  return (

    <>

      <div className={clsx(css.triggerRow, !wide && css.railRow)}>

        <button

          ref={triggerRef}

          type="button"

          className={clsx(css.trigger, !wide && css.rail)}

          aria-haspopup="dialog"

          aria-expanded={open}

          onClick={() => { setOpen(true) }}

        >

          {renderSlot('settings.trigger', { wide })}

        </button>

        <ConnectionIndicator

          state={wide ? connectionIndicator : undefined}

          disconnectedLabel={t('connection.error')}

          reconnectLabel={t('connection.retry')}

          connectingLabel={t('connection.connecting')}

          recoveredLabel={t('connection.connected')}

          reconnectActionLabel={t('connection.reconnect')}

          restartActionLabel={t('connection.restart')}

          onReconnect={reconnect}

        />

      </div>

      {open && (

        <SettingsPanel

          rows={rows}

          renderSlot={renderSlot}

          activeId={activeId}

          onSelect={setActiveId}

          onClose={close}

          openerRef={triggerRef}

        />

      )}

      {/* Dialog chrome and `#root` inert ownership live inside each step's

          visible branch. A step still deciding (private facts loading)

          renders null, so nothing paints or blocks while it decides. */}

      {onboardingStep !== undefined && renderSlot('settings.onboarding', {

        stepId: onboardingStep.id,

        complete: () => { completeOnboardingStep(onboardingStep.id) },

        openSection,

      }, { only: onboardingStep.id })}

    </>

  )

}


