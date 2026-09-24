/** The computer-use card's staged form over the `computer-use` namespace. */

import type { IApiClient } from '@xrkseek/client-connection/client'
import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import {
  CardForm,
  type CardActions,
  type CardFieldState,
  type CardFieldSpec,
  type CardShell,
  type FieldWrite,
} from './card-form.ts'

/** Face namespace — must match `FACE_PRODUCT_SETTINGS_NAMESPACES`. */
export const COMPUTER_USE_NS = 'computer-use'

/** Credential ref for the background helper path. */
export const COMPUTER_USE_BACKGROUND_REF = 'XRK_COMPUTER_USE_BACKGROUND'

/** Modes the card may stage. */
export type ComputerUseMode = 'off' | 'uia' | 'background'

/** Host-served computer-use section. */
export interface ComputerUseSettings {
  readonly mode?: ComputerUseMode | string
}

/** What the credentials domain last reported for the helper slot. */
interface CredentialState {
  readonly configured: boolean
  readonly writable: boolean
}

/** What the computer-use card renders. */
export interface ComputerUseCardState extends CardShell {
  readonly mode: CardFieldState
  readonly backgroundHelper: CardFieldState
  readonly backgroundConfigured: boolean
  readonly backgroundWritable: boolean
}

/** The registration-side face the computer-use card's slot entry injects. */
export interface ComputerUseCardFace extends CardActions {
  hooks: {
    computerUseCard: SnapshotStore<ComputerUseCardState>
  }
}

const MODES: readonly ComputerUseMode[] = ['off', 'uia', 'background']
const HELPER_FIELD = 'backgroundHelper'

function modeField(): CardFieldSpec {
  return {
    field: 'mode',
    format: (value) => (typeof value === 'string' && value ? value : 'off'),
    parse: (text): FieldWrite | undefined => {
      const trimmed = text.trim() || 'off'
      if (!(MODES as readonly string[]).includes(trimmed)) return undefined
      return { kind: 'set', value: trimmed }
    },
  }
}

/** Bridges the `computer-use` scope and background helper credential onto the card. */
export class ComputerUseCardController {
  private readonly form: CardForm<ComputerUseSettings>
  private readonly store: SnapshotStore<ComputerUseCardState>
  private helper: CredentialState = { configured: false, writable: true }

  /**
   * @param scope - the bound settings scope for the `computer-use` namespace.
   * @param api - wire face for Credentials (helper path never rides settings).
   */
  constructor(
    scope: SettingsScope<ComputerUseSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.form = new CardForm(
      scope,
      [modeField()],
      [
        {
          field: HELPER_FIELD,
          write: (text) => this.writeHelper(text),
        },
      ],
    )
    this.store = this.form.bind(() => this.projection())
    void this.readCredential()
  }

  private projection(): ComputerUseCardState {
    return {
      ...this.form.shell(),
      mode: this.form.field('mode'),
      backgroundHelper: this.form.field(HELPER_FIELD),
      backgroundConfigured: this.helper.configured,
      backgroundWritable: this.helper.writable,
    }
  }

  private async readCredential(): Promise<void> {
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({
        refs: [COMPUTER_USE_BACKGROUND_REF],
      })
    } catch {
      return
    }
    if (!response.result.ok) return
    const row = response.result.value.credentials[COMPUTER_USE_BACKGROUND_REF]
    const next: CredentialState = {
      configured: row?.configured ?? false,
      writable: row?.writable ?? true,
    }
    if (
      next.configured === this.helper.configured
      && next.writable === this.helper.writable
    ) {
      return
    }
    this.helper = next
    this.store.set(this.projection())
  }

  /**
   * Re-read when Host reports the watched credential changed.
   * @param ref - envVar / slot ref from `credentials/updated`.
   */
  refreshCredential(ref: string): void {
    if (ref !== COMPUTER_USE_BACKGROUND_REF) return
    void this.readCredential()
  }

  /** @returns the card's snapshot and its form actions. */
  inject(): ComputerUseCardFace {
    return { hooks: { computerUseCard: this.store }, ...this.form.actions() }
  }

  private async writeHelper(value: string): Promise<boolean> {
    try {
      await this.api.credentials.set({ ref: COMPUTER_USE_BACKGROUND_REF, value })
    } catch {
      /* Host refusal surfaces via re-read */
    }
    await this.readCredential()
    return this.helper.configured
  }
}
