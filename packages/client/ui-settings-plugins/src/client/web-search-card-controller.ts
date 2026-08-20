/** The web-search card's staged form over the `web-search` settings namespace. */

import type { IApiClient } from '@xrkseek/client-connection/client'
import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import {
  CardForm,
  textField,
  type CardActions,
  type CardFieldState,
  type CardFieldSpec,
  type CardShell,
  type FieldWrite,
} from './card-form.ts'

/** Namespace Host serves for web_search provider preference. */
export const WEB_SEARCH_NS = 'web-search'

/** Credential refs Face emits on `credentials/updated` (envVar of the slot). */
export const WEB_SEARCH_TAVILY_REF = 'XRK_TAVILY_API_KEY'
export const WEB_SEARCH_BRAVE_REF = 'XRK_BRAVE_SEARCH_API_KEY'

const TAVILY_FIELD = 'tavilyApiKey'
const BRAVE_FIELD = 'braveApiKey'

/** Provider ids the card may stage. */
export type WebSearchProviderId =
  | 'auto'
  | 'tavily'
  | 'brave'
  | 'parallel-free'
  | 'duckduckgo'

/** Host-served web-search section. */
export interface WebSearchSettings {
  readonly provider?: WebSearchProviderId | string
  readonly region?: string
}

/** What the credentials domain last reported for one ref. */
interface CredentialState {
  readonly configured: boolean
  readonly writable: boolean
}

/** What the web-search card renders. */
export interface WebSearchCardState extends CardShell {
  readonly provider: CardFieldState
  readonly region: CardFieldState
  readonly tavilyApiKey: CardFieldState
  readonly braveApiKey: CardFieldState
  readonly tavilyConfigured: boolean
  readonly tavilyWritable: boolean
  readonly braveConfigured: boolean
  readonly braveWritable: boolean
}

/** The registration-side face the web-search card's slot entry injects. */
export interface WebSearchCardFace extends CardActions {
  hooks: {
    webSearchCard: SnapshotStore<WebSearchCardState>
  }
}

const PROVIDERS: readonly WebSearchProviderId[] = [
  'auto',
  'tavily',
  'brave',
  'parallel-free',
  'duckduckgo',
]

function providerField(): CardFieldSpec {
  return {
    field: 'provider',
    format: (value) => (typeof value === 'string' && value ? value : 'auto'),
    parse: (text): FieldWrite | undefined => {
      const trimmed = text.trim() || 'auto'
      if (!(PROVIDERS as readonly string[]).includes(trimmed)) return undefined
      return { kind: 'set', value: trimmed }
    },
  }
}

/** Bridges the `web-search` scope and Tavily/Brave credentials onto the card. */
export class WebSearchCardController {
  private readonly form: CardForm<WebSearchSettings>
  private readonly store: SnapshotStore<WebSearchCardState>
  private tavily: CredentialState = { configured: false, writable: true }
  private brave: CredentialState = { configured: false, writable: true }

  /**
   * @param scope - the bound settings scope for the `web-search` namespace.
   * @param api - wire face for Credentials (keys never ride settings).
   */
  constructor(
    scope: SettingsScope<WebSearchSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.form = new CardForm(
      scope,
      [providerField(), textField('region')],
      [
        { field: TAVILY_FIELD, write: (text) => this.writeKey(WEB_SEARCH_TAVILY_REF, text) },
        { field: BRAVE_FIELD, write: (text) => this.writeKey(WEB_SEARCH_BRAVE_REF, text) },
      ],
    )
    this.store = this.form.bind(() => this.projection())
    void this.readCredentials()
  }

  private projection(): WebSearchCardState {
    return {
      ...this.form.shell(),
      provider: this.form.field('provider'),
      region: this.form.field('region'),
      tavilyApiKey: this.form.field(TAVILY_FIELD),
      braveApiKey: this.form.field(BRAVE_FIELD),
      tavilyConfigured: this.tavily.configured,
      tavilyWritable: this.tavily.writable,
      braveConfigured: this.brave.configured,
      braveWritable: this.brave.writable,
    }
  }

  /** Ask the credentials domain about Tavily + Brave slots. */
  private async readCredentials(): Promise<void> {
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({
        refs: [WEB_SEARCH_TAVILY_REF, WEB_SEARCH_BRAVE_REF],
      })
    } catch {
      return
    }
    if (!response.result.ok) return
    const map = response.result.value.credentials
    const nextTavily: CredentialState = {
      configured: map[WEB_SEARCH_TAVILY_REF]?.configured ?? false,
      writable: map[WEB_SEARCH_TAVILY_REF]?.writable ?? true,
    }
    const nextBrave: CredentialState = {
      configured: map[WEB_SEARCH_BRAVE_REF]?.configured ?? false,
      writable: map[WEB_SEARCH_BRAVE_REF]?.writable ?? true,
    }
    if (
      nextTavily.configured === this.tavily.configured
      && nextTavily.writable === this.tavily.writable
      && nextBrave.configured === this.brave.configured
      && nextBrave.writable === this.brave.writable
    ) {
      return
    }
    this.tavily = nextTavily
    this.brave = nextBrave
    this.store.set(this.projection())
  }

  /**
   * Re-read when Host reports a watched credential changed (e.g. Credentials page).
   * @param ref - envVar / slot ref from `credentials/updated`.
   */
  refreshCredential(ref: string): void {
    if (ref !== WEB_SEARCH_TAVILY_REF && ref !== WEB_SEARCH_BRAVE_REF) return
    void this.readCredentials()
  }

  /** @returns the card's snapshot and its form actions. */
  inject(): WebSearchCardFace {
    return { hooks: { webSearchCard: this.store }, ...this.form.actions() }
  }

  private async writeKey(ref: string, value: string): Promise<boolean> {
    try {
      await this.api.credentials.set({ ref, value })
    } catch {
      /* Host refusal surfaces via re-read */
    }
    await this.readCredentials()
    if (ref === WEB_SEARCH_TAVILY_REF) return this.tavily.configured
    if (ref === WEB_SEARCH_BRAVE_REF) return this.brave.configured
    return false
  }
}
