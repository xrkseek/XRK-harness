/**
 * Desktop shell card: prevent idle sleep + session-complete OS notify.
 * Face `desktop` ns is SoT; Desktop IPC mirrors preventIdleSleep for main.
 */

import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import { setOsNotifyPolicy } from '@xrkseek/client-runtime/client'
import {
  CardForm,
  booleanField,
  type CardActions,
  type CardFieldSpec,
  type CardFieldState,
  type CardShell,
  type FieldWrite,
} from './card-form.ts'

/** Face namespace — must match `FACE_PRODUCT_SETTINGS_NAMESPACES`. */
export const DESKTOP_NS = 'desktop'

export interface DesktopSettings {
  readonly preventIdleSleep?: boolean
  readonly notifyOnComplete?: boolean
  readonly notifyFocusPolicy?: 'unfocused' | 'always'
}

export interface DesktopCardState extends CardShell {
  readonly preventIdleSleep: CardFieldState
  readonly notifyOnComplete: CardFieldState
  readonly notifyFocusPolicy: CardFieldState
}

export interface DesktopCardFace extends CardActions {
  hooks: {
    desktopCard: SnapshotStore<DesktopCardState>
  }
  /**
   * Stage for UI, arm bridge/notify immediately, write Face directly
   * (coalesced). Avoids CardForm.save clearing a newer draft mid-flight.
   */
  commit: (field: keyof DesktopSettings, value: string) => void
}

function focusPolicyField(): CardFieldSpec {
  return {
    field: 'notifyFocusPolicy',
    format: (value) =>
      value === 'always' || value === 'unfocused' ? value : 'unfocused',
    parse: (text): FieldWrite | undefined => {
      const trimmed = text.trim()
      if (trimmed === 'always' || trimmed === 'unfocused') {
        return { kind: 'set', value: trimmed }
      }
      return undefined
    },
  }
}

type PreventIdleSleepBridge = {
  setEnabled(enabled: boolean): Promise<unknown>
}

function preventIdleSleepBridge(): PreventIdleSleepBridge | undefined {
  const root = (globalThis as {
    xrkDesktop?: { preventIdleSleep?: PreventIdleSleepBridge }
  }).xrkDesktop
  return root?.preventIdleSleep
}

function applyClientSideEffects(settings: DesktopSettings): void {
  const sleepOn = settings.preventIdleSleep === true
  const bridge = preventIdleSleepBridge()
  if (bridge !== undefined) {
    void bridge.setEnabled(sleepOn).catch(() => {
      /* older bridge / quit */
    })
  }
  setOsNotifyPolicy({
    enabled: settings.notifyOnComplete !== false,
    focusPolicy: settings.notifyFocusPolicy === 'always' ? 'always' : 'unfocused',
  })
}

function settingsKey(settings: DesktopSettings): string {
  return [
    settings.preventIdleSleep === true ? 'true' : 'false',
    settings.notifyOnComplete === false ? 'false' : 'true',
    settings.notifyFocusPolicy === 'always' ? 'always' : 'unfocused',
  ].join('|')
}

function parseDesktopField(
  field: keyof DesktopSettings,
  text: string,
): unknown | undefined {
  if (field === 'notifyFocusPolicy') {
    const trimmed = text.trim()
    return trimmed === 'always' || trimmed === 'unfocused' ? trimmed : undefined
  }
  if (field === 'preventIdleSleep' || field === 'notifyOnComplete') {
    if (text === 'true') return true
    if (text === 'false') return false
    return undefined
  }
  return undefined
}

/** Bridges the `desktop` scope onto the card. */
export class DesktopCardController {
  private readonly form: CardForm<DesktopSettings>
  private readonly store: SnapshotStore<DesktopCardState>
  private readonly scope: SettingsScope<DesktopSettings>
  private lastSyncedKey = ''
  private commitGeneration = 0

  constructor(scope: SettingsScope<DesktopSettings>) {
    this.scope = scope
    this.form = new CardForm(scope, [
      booleanField('preventIdleSleep', false),
      booleanField('notifyOnComplete', true),
      focusPolicyField(),
    ])
    this.store = this.form.bind(() => {
      const state = this.projection()
      this.maybeSyncEffects(state)
      return state
    })
  }

  private projection(): DesktopCardState {
    return {
      ...this.form.shell(),
      preventIdleSleep: this.form.field('preventIdleSleep'),
      notifyOnComplete: this.form.field('notifyOnComplete'),
      notifyFocusPolicy: this.form.field('notifyFocusPolicy'),
    }
  }

  private effectiveSettings(state: DesktopCardState): DesktopSettings {
    return {
      preventIdleSleep: state.preventIdleSleep.text === 'true',
      notifyOnComplete: state.notifyOnComplete.text !== 'false',
      notifyFocusPolicy:
        state.notifyFocusPolicy.text === 'always' ? 'always' : 'unfocused',
    }
  }

  private maybeSyncEffects(state: DesktopCardState): void {
    // While dirty, commit() owns effects from the staged draft.
    if (!state.available || state.dirty || state.saving) return
    const next = this.effectiveSettings(state)
    const key = settingsKey(next)
    if (key === this.lastSyncedKey) return
    this.lastSyncedKey = key
    applyClientSideEffects(next)
  }

  /**
   * Stage for UI, arm side effects now, write Face with generation coalesce
   * so rapid spam cannot leave Host / bridge on a stale intermediate value.
   */
  private commit(field: keyof DesktopSettings, text: string): void {
    const value = parseDesktopField(field, text)
    if (value === undefined) return
    this.form.actions().edit(field, text)
    const next = this.effectiveSettings(this.store.getSnapshot())
    this.lastSyncedKey = settingsKey(next)
    applyClientSideEffects(next)
    const generation = ++this.commitGeneration
    void this.scope.set(field, value).then(() => {
      if (generation !== this.commitGeneration) return
      // Staged drafts that now match Host drop out of dirty via CardForm.plan.
      this.lastSyncedKey = ''
      this.maybeSyncEffects(this.store.getSnapshot())
    }).catch(() => {
      if (generation !== this.commitGeneration) return
      this.lastSyncedKey = ''
      this.maybeSyncEffects(this.store.getSnapshot())
    })
  }

  inject(): DesktopCardFace {
    const actions = this.form.actions()
    return {
      hooks: { desktopCard: this.store },
      ...actions,
      commit: (field, value) => { this.commit(field, value) },
      save: () => {
        void (async () => {
          await this.form.save()
          this.lastSyncedKey = ''
          this.maybeSyncEffects(this.store.getSnapshot())
        })()
      },
    }
  }
}
