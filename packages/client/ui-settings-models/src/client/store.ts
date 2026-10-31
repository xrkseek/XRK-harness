/**
 * Models settings page store: one snapshot joining the configurable-provider
 * directory (`llm.providers`), the settings namespaces (`settings.describe`),
 * and the referenced credentials (`credentials.describe`). The host stays the
 * single fact source — every mutation writes through the wire and the page
 * re-renders from the next describe, pushed or refetched.
 */

import type {
  ConfigurableProviderView, CredentialView, IApiClient, ModelProviderGroup,
  SettingsNamespaceView,
} from '@xrkseek/xrk-api-remotes/client'
import type { SnapshotStore } from '@xrkseek/client-runtime/client'
import { createSnapshotStore } from '@xrkseek/client-runtime/client'
import { getPath, hasPath, nodeAtPath, rehydrateSchema } from '@xrkseek/client-schema-form'

/**
 * Any route key walks a dict schema to the same profile node, so the lookup
 * names one that cannot collide with a configured route.
 */
const PROBE_ROUTE = '\u0000probe'

/** Settings namespace for the fleet default New Session falls back to. */
export const AGENT_DEFAULT_MODEL_NS = 'agent-default-model'

/** Settings namespace that owns Models list order (`providerOrder`). */
export const LLM_PI_AI_NS = 'llm-pi-ai'

/**
 * Move one provider id before an optional anchor (DOM-insertBefore semantics).
 * No-op when ids are unknown or the move would not change order.
 */
export function insertProviderBefore(
  ids: readonly string[],
  id: string,
  beforeId?: string,
): string[] {
  if (!ids.includes(id) || (beforeId !== undefined && !ids.includes(beforeId)) || beforeId === id) {
    return [...ids]
  }
  const without = ids.filter(candidate => candidate !== id)
  const at = beforeId === undefined ? without.length : without.indexOf(beforeId)
  return [...without.slice(0, at), id, ...without.slice(at)]
}

/** One selectable default-model row (`provider/model`). */
export interface DefaultModelOption {
  readonly value: string
  readonly label: string
}

/** Resolved `agent-default-model` selection. */
export interface DefaultModelSelection {
  readonly provider: string
  readonly model: string
}

/** Encode a catalog route as the select value. */
export function defaultModelRoute(provider: string, model: string): string {
  return `${provider}/${model}`
}

/** Parse a select value back into provider + model. */
export function parseDefaultModelRoute(value: string): DefaultModelSelection | undefined {
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return undefined
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) }
}

function selectionFromNamespace(view: SettingsNamespaceView | undefined): DefaultModelSelection | null {
  if (view === undefined || view.value === null || typeof view.value !== 'object') return null
  const raw = view.value as { provider?: unknown; model?: unknown }
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : ''
  const model = typeof raw.model === 'string' ? raw.model.trim() : ''
  if (!provider || !model) return null
  return { provider, model }
}

function optionsFromCatalog(
  groups: readonly ModelProviderGroup[],
  current: DefaultModelSelection | null,
): DefaultModelOption[] {
  const rows: DefaultModelOption[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    for (const model of group.models) {
      const value = defaultModelRoute(group.id, model.id)
      if (seen.has(value)) continue
      seen.add(value)
      rows.push({
        value,
        label: model.name === model.id
          ? `${group.name} · ${model.id}`
          : `${group.name} · ${model.name}`,
      })
    }
  }
  if (current !== null) {
    const value = defaultModelRoute(current.provider, current.model)
    if (!seen.has(value)) {
      rows.unshift({ value, label: `${current.provider}/${current.model}` })
    }
  }
  return rows
}

function sameDefaultModelOptions(
  left: readonly DefaultModelOption[],
  right: readonly DefaultModelOption[],
): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    const a = left[i]
    const b = right[i]
    if (a === undefined || b === undefined) return false
    if (a.value !== b.value || a.label !== b.label) return false
  }
  return true
}

/**
 * Soft reload after `providerOrder` only reorders the same routes — keep the
 * prior `<option>` list so the native select does not remount / flash away.
 */
function sameDefaultModelOptionSet(
  left: readonly DefaultModelOption[],
  right: readonly DefaultModelOption[],
): boolean {
  if (left.length !== right.length) return false
  const rightByValue = new Map(right.map((row) => [row.value, row.label]))
  for (const row of left) {
    if (rightByValue.get(row.value) !== row.label) return false
  }
  return true
}

/** One provider row the page renders. */
export interface ProviderRow {
  /** The directory entry (route id, display name, settings address, live state). */
  entry: ConfigurableProviderView
  /** Whether any layer configures this provider (its profile resolves). */
  configured: boolean
  /** Whether the user layer alone carries the profile (removal restores the base). */
  removable: boolean
  /** The credential reference the resolved profile names, when one does. */
  apiKeyEnv: string | undefined
  /** Credential state for {@link apiKeyEnv}, once described. */
  credential: CredentialView | undefined
}

/** Page snapshot. */
export interface ModelsSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text; row-level write failures stay in the editor. */
  error: string | null
  /** Credential enrichment failure; provider/settings rows remain usable. */
  credentialError: string | null
  /** Whether the settings provider accepts writes. */
  writable: boolean
  /** Every configurable provider joined with its configured/credential state. */
  rows: readonly ProviderRow[]
  /** Namespace views by ns, for the editor's schema/layers/secrets. */
  namespaces: ReadonlyMap<string, SettingsNamespaceView>
  /** Fleet default model (New Session when inherit has no source). */
  defaultModel: DefaultModelSelection | null
  /** True when the user layer overrides the composition base. */
  defaultModelOverridden: boolean
  /** Revision of `agent-default-model` for mutate CAS. */
  defaultModelRevision: number
  /** Catalog rows for the default-model select. */
  defaultModelOptions: readonly DefaultModelOption[]
}

/**
 * Human text for a rejected wire call. A transport failure rejects with an
 * Error; a host or a runtime can reject with anything, and the page still has
 * to say something.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Derive the conventional credential reference for a provider route: the v1
 * page never asks for an environment-variable name, so a typed key stores
 * under this derived reference and the profile records it as `apiKeyEnv`.
 * @param provider - provider route id (e.g. `anthropic`, `groq`).
 * @returns the derived reference name (e.g. `GROQ_API_KEY`).
 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * The wire protocols a hand-declared route may name, read out of the owning
 * namespace's own schema. This stays a schema read rather than a wire field so
 * the choices the page offers cannot drift from the ones the adapter accepts:
 * both come from the same `Config`.
 * @param namespace - the namespace view whose schema declares the profile shape.
 * @returns the protocol identifiers, or an empty list when the schema has none.
 */
export function protocolChoices(namespace: SettingsNamespaceView | undefined): string[] {
  if (namespace === undefined) return []
  const node = nodeAtPath(rehydrateSchema(namespace.schema), ['providers', PROBE_ROUTE, 'api'])
  const list = (node as { type?: string; list?: readonly { value?: unknown }[] } | undefined)
  if (list?.type !== 'union' || list.list === undefined) return []
  return list.list.map(entry => entry.value).filter((value): value is string => typeof value === 'string')
}

/** The credential reference a resolved profile names (its `apiKeyEnv` field). */
function apiKeyEnvOf(namespace: SettingsNamespaceView | undefined, path: readonly string[]): string | undefined {
  if (namespace === undefined) return undefined
  const profile = getPath(namespace.value, path)
  if (typeof profile !== 'object' || profile === null) return undefined
  const ref = (profile as { apiKeyEnv?: unknown }).apiKeyEnv
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

/** The models settings page controller (one per settings surface). */
export class ModelsSettingsStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<ModelsSettingsState> = createSnapshotStore<ModelsSettingsState>({
    status: 'idle',
    error: null,
    credentialError: null,
    writable: false,
    rows: [],
    namespaces: new Map(),
    defaultModel: null,
    defaultModelOverridden: false,
    defaultModelRevision: 0,
    defaultModelOptions: [],
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param api - the wire face (settings/credentials/llm domains).
   */
  constructor(private readonly api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>) {}

  /**
   * Refresh the whole page snapshot: directory, namespaces, and catalog in
   * parallel, then one batched credential describe over every referenced ref.
   * A failure keeps the last good rows and surfaces the error.
   * @param opts.soft - when true and the page is already ready, keep `status`
   *   as ready so the default-model select does not unmount (reorder / mutate
   *   echoes used to flash it away via a loading gate).
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(opts: { readonly soft?: boolean } = {}): Promise<void> {
    const generation = ++this.generation
    const soft = opts.soft === true && this.store.getSnapshot().status === 'ready'
    if (!soft) {
      this.store.update((s) => { s.status = 'loading'; s.error = null })
    } else {
      this.store.update((s) => { s.error = null })
    }
    let providers: ConfigurableProviderView[]
    let writable: boolean
    let views: SettingsNamespaceView[]
    let catalogGroups: readonly ModelProviderGroup[] = []
    try {
      const [providersResponse, settingsResponse, modelsResponse] = await Promise.all([
        this.api.llm.providers({}),
        this.api.settings.describe({}),
        this.api.llm.models({}),
      ])
      if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message)
      if (!settingsResponse.result.ok) throw new Error(settingsResponse.result.error.message)
      providers = providersResponse.result.value.providers
      writable = settingsResponse.result.value.writable
      views = settingsResponse.result.value.namespaces
      if (modelsResponse.result.ok) {
        catalogGroups = modelsResponse.result.value.groups
      }
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        // Soft reload keeps the prior ready paint; only cold loads flip to error.
        if (!soft) s.status = 'error'
        s.error = error instanceof Error ? error.message : String(error)
      })
      return
    }
    const namespaces = new Map(views.map(view => [view.ns, view]))
    const defaultNs = namespaces.get(AGENT_DEFAULT_MODEL_NS)
    const defaultModel = selectionFromNamespace(defaultNs)
    const defaultModelOverridden = defaultNs !== undefined && (
      hasPath(defaultNs.user, ['provider']) || hasPath(defaultNs.user, ['model'])
    )
    const rows: ProviderRow[] = providers.map((entry) => {
      const namespace = namespaces.get(entry.settingsNs)
      const configured = namespace !== undefined
        && (entry.settingsPath.length === 0 || getPath(namespace.value, entry.settingsPath) !== undefined)
      const removable = namespace !== undefined
        && entry.settingsPath.length > 0
        && hasPath(namespace.user, entry.settingsPath)
        && !hasPath(namespace.base, entry.settingsPath)
      return {
        entry,
        configured,
        removable,
        apiKeyEnv: apiKeyEnvOf(namespace, entry.settingsPath),
        credential: undefined,
      }
    })
    const refs = [...new Set(rows.flatMap(row => row.apiKeyEnv === undefined ? [] : [row.apiKeyEnv]))]
    let credentials: Record<string, CredentialView> = {}
    let credentialError: string | null = null
    if (refs.length > 0) {
      try {
        const response = await this.api.credentials.describe({ refs })
        // Credential state is an enrichment for the Models page: neither a
        // business rejection nor a transport failure fails the load. The
        // onboarding projection below retains the failure distinction.
        if (response.result.ok) credentials = response.result.value.credentials
        else credentialError = response.result.error.message
      } catch (error) {
        credentialError = messageOf(error)
      }
    }
    if (generation !== this.generation) return
    const nextOptions = optionsFromCatalog(catalogGroups, defaultModel)
    this.store.update((s) => {
      s.status = 'ready'
      s.error = null
      s.credentialError = credentialError
      s.writable = writable
      s.rows = rows.map(row => ({
        ...row,
        ...row.apiKeyEnv !== undefined && credentials[row.apiKeyEnv] !== undefined
          ? { credential: credentials[row.apiKeyEnv] }
          : {},
      }))
      s.namespaces = namespaces
      // Soft reloads must not churn the default-model select when the
      // selection is unchanged — rewriting options remounts <option> nodes
      // and native controls flash (provider reorder used to do this every drop).
      // Order-only catalog churn (providerOrder) keeps the prior option list.
      const sameSelection = soft
        && s.defaultModel?.provider === defaultModel?.provider
        && s.defaultModel?.model === defaultModel?.model
        && s.defaultModelOverridden === defaultModelOverridden
        && s.defaultModelRevision === (defaultNs?.revision ?? 0)
        && (
          sameDefaultModelOptions(s.defaultModelOptions, nextOptions)
          || sameDefaultModelOptionSet(s.defaultModelOptions, nextOptions)
        )
      if (!sameSelection) {
        s.defaultModel = defaultModel
        s.defaultModelOverridden = defaultModelOverridden
        s.defaultModelRevision = defaultNs?.revision ?? 0
        s.defaultModelOptions = nextOptions
      }
    })
  }

  /**
   * Persist the fleet default model (`agent-default-model`).
   * @param selection - provider + model from the catalog select.
   * @returns failure text, or undefined on success.
   */
  async setDefaultModel(selection: DefaultModelSelection): Promise<string | undefined> {
    const snap = this.store.getSnapshot()
    try {
      const response = await this.api.settings.mutate({
        ns: AGENT_DEFAULT_MODEL_NS,
        expectedRevision: snap.defaultModelRevision,
        ops: [
          { op: 'set', path: ['provider'], value: selection.provider },
          { op: 'set', path: ['model'], value: selection.model },
        ],
      })
      if (!response.result.ok) return response.result.error.message
    } catch (error) {
      return messageOf(error)
    }
    await this.load({ soft: true })
    return undefined
  }

  /**
   * Clear the user override so the composition base default returns.
   * @returns failure text, or undefined on success.
   */
  async resetDefaultModel(): Promise<string | undefined> {
    const snap = this.store.getSnapshot()
    try {
      const response = await this.api.settings.mutate({
        ns: AGENT_DEFAULT_MODEL_NS,
        expectedRevision: snap.defaultModelRevision,
        ops: [
          { op: 'unset', path: ['provider'] },
          { op: 'unset', path: ['model'] },
          { op: 'unset', path: ['reasoningEffort'] },
        ],
      })
      if (!response.result.ok) return response.result.error.message
    } catch (error) {
      return messageOf(error)
    }
    await this.load({ soft: true })
    return undefined
  }

  /**
   * Persist Settings → Models row order (`llm-pi-ai.providerOrder`) after a
   * long-press reorder. Optimistic local splice only — a post-success soft
   * reload used to re-fetch `llm.models` and rewrite default-model `<option>`
   * order, which makes the native select flash even when status stayed ready.
   * @param providerId - moved provider route id.
   * @param beforeProviderId - insert-before anchor; omit to append.
   * @returns failure text, or undefined on success.
   */
  async reorderProviders(
    providerId: string,
    beforeProviderId?: string,
  ): Promise<string | undefined> {
    const snap = this.store.getSnapshot()
    const configuredIds = snap.rows
      .filter(row => row.configured)
      .map(row => row.entry.provider)
    const nextIds = insertProviderBefore(configuredIds, providerId, beforeProviderId)
    if (nextIds.join('\0') === configuredIds.join('\0')) return undefined

    const byId = new Map(snap.rows.map(row => [row.entry.provider, row]))
    const nextConfigured = nextIds.flatMap(id => {
      const row = byId.get(id)
      return row === undefined ? [] : [row]
    })
    const rest = snap.rows.filter(row => !row.configured)
    const optimisticRows = [...nextConfigured, ...rest]
    // One notify for the optimistic splice — a second namespaces-only update
    // after mutate used to re-render the whole Models page (default-model
    // <select> rebuilds options and flashes) even when defaultModel* was
    // untouched.
    this.store.update((s) => {
      s.rows = optimisticRows
    })

    const piAi = snap.namespaces.get(LLM_PI_AI_NS)
    try {
      const response = await this.api.settings.mutate({
        ns: LLM_PI_AI_NS,
        ...(piAi !== undefined ? { expectedRevision: piAi.revision } : {}),
        ops: [{ op: 'set', path: ['providerOrder'], value: nextIds }],
      })
      if (!response.result.ok) {
        await this.load({ soft: true })
        return response.result.error.message
      }
      // Patch only the mutated namespace revision; leave defaultModel* alone.
      // Build the next Map from the plain snapshot — drafting Map#set needs
      // Immer MapSet, which this store does not enable.
      const nextNamespaces = new Map(this.store.getSnapshot().namespaces)
      nextNamespaces.set(LLM_PI_AI_NS, response.result.value)
      this.store.update((s) => {
        s.namespaces = nextNamespaces
      })
    } catch (error) {
      await this.load({ soft: true })
      return messageOf(error)
    }
    return undefined
  }
}

/**
 * Whether a joined row can serve model requests as it stands: the route is
 * registered with the adapter registry, and whatever credential its resolved
 * profile names is stored. A profile naming no reference authenticates through
 * the provider's own path (the Bedrock chain, Vertex ADC, a gateway that needs
 * nothing), as does a live route with no settings address at all, so neither
 * owes this page a key.
 * @param row - one joined provider row.
 * @returns whether the user already has this provider to talk to.
 */
export function providerUsable(row: ProviderRow): boolean {
  // Dormant directory entries are not yet configured — never treat them as ready.
  if (!row.configured) return false
  if (!row.entry.active) return false
  if (row.apiKeyEnv === undefined) return true
  return row.credential?.configured === true
}
