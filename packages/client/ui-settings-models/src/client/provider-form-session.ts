/**
 * Durable Settings → Models add / custom-provider draft session.
 * Survives Settings modal unmount (backdrop dismiss) so reopening continues
 * the same card with typed fields. Memory-only — never localStorage (API keys).
 * Cleared on Cancel, successful create/apply, or explicit reset in tests.
 */

import type { ModelDraft } from './model-list-sync.ts'

/** Target for the catalog "添加提供方" card. */
export type AddingFormTarget = {
  readonly provider: string
  readonly displayName: string
  readonly settingsNs: string
  readonly settingsPath: readonly string[]
  readonly credentialRef?: string
  readonly declared?: boolean
}

/** Fields the catalog-add editor persists while open. */
export type AddingDraftPersist = {
  readonly draft: Record<string, unknown>
  readonly keyDraft: string
}

/** Fields the custom-create card persists while open. */
export type DeclaringDraftPersist = {
  readonly route: string
  readonly displayName: string
  readonly baseURL: string
  readonly proxy: string
  readonly protocol: string
  readonly keyDraft: string
  readonly models: readonly ModelDraft[]
}

export type AddingFormSession = {
  readonly kind: 'adding'
  readonly target: AddingFormTarget
  readonly draft: Record<string, unknown>
  readonly keyDraft: string
}

export type DeclaringFormSession = {
  readonly kind: 'declaring'
} & DeclaringDraftPersist

export type ProviderFormSession =
  | { readonly kind: 'idle' }
  | AddingFormSession
  | DeclaringFormSession

const IDLE: ProviderFormSession = { kind: 'idle' }

let state: ProviderFormSession = IDLE
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function replace(next: ProviderFormSession): void {
  state = next
  emit()
}

function cloneTarget(target: AddingFormTarget): AddingFormTarget {
  return {
    provider: target.provider,
    displayName: target.displayName,
    settingsNs: target.settingsNs,
    settingsPath: [...target.settingsPath],
    ...(target.credentialRef !== undefined
      ? { credentialRef: target.credentialRef }
      : {}),
    ...(target.declared === true ? { declared: true } : {}),
  }
}

function cloneDraft(draft: Record<string, unknown>): Record<string, unknown> {
  return { ...draft }
}

function cloneModels(models: readonly ModelDraft[]): ModelDraft[] {
  return models.map((row) => ({ ...row }))
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Subscribe (useSyncExternalStore). */
export function subscribeProviderFormSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getProviderFormSession(): ProviderFormSession {
  return state
}

/** Snapshot for remount seed — deep-cloned so later patches cannot mutate it. */
export function snapshotProviderFormSession(): ProviderFormSession {
  if (state.kind === 'idle') return IDLE
  if (state.kind === 'adding') {
    return {
      kind: 'adding',
      target: cloneTarget(state.target),
      draft: cloneDraft(state.draft),
      keyDraft: state.keyDraft,
    }
  }
  return {
    kind: 'declaring',
    route: state.route,
    displayName: state.displayName,
    baseURL: state.baseURL,
    proxy: state.proxy,
    protocol: state.protocol,
    keyDraft: state.keyDraft,
    models: cloneModels(state.models),
  }
}

/** Open / replace the catalog add card (empty draft unless seeding). */
export function beginAddingProviderForm(
  target: AddingFormTarget,
  seed?: Partial<AddingDraftPersist>,
): void {
  replace({
    kind: 'adding',
    target: cloneTarget(target),
    draft: seed?.draft !== undefined ? cloneDraft(seed.draft) : {},
    keyDraft: seed?.keyDraft ?? '',
  })
}

/** Open / replace the custom-provider create card. */
export function beginDeclaringProviderForm(
  seed?: Partial<DeclaringDraftPersist>,
): void {
  replace({
    kind: 'declaring',
    route: seed?.route ?? '',
    displayName: seed?.displayName ?? '',
    baseURL: seed?.baseURL ?? '',
    proxy: seed?.proxy ?? '',
    protocol: seed?.protocol ?? '',
    keyDraft: seed?.keyDraft ?? '',
    models: seed?.models !== undefined ? cloneModels(seed.models) : [],
  })
}

/** Patch fields on the live adding session (no-op if not adding / unchanged). */
export function patchAddingProviderForm(
  patch: Partial<AddingDraftPersist> & { readonly target?: AddingFormTarget },
): void {
  if (state.kind !== 'adding') return
  const nextTarget = patch.target !== undefined
    ? cloneTarget(patch.target)
    : state.target
  const nextDraft = patch.draft !== undefined
    ? cloneDraft(patch.draft)
    : cloneDraft(state.draft)
  const nextKey = patch.keyDraft !== undefined ? patch.keyDraft : state.keyDraft
  if (
    nextKey === state.keyDraft
    && sameJson(nextDraft, state.draft)
    && sameJson(nextTarget, state.target)
  ) {
    return
  }
  replace({
    kind: 'adding',
    target: nextTarget,
    draft: nextDraft,
    keyDraft: nextKey,
  })
}

/** Patch fields on the live declaring session (no-op if not declaring / unchanged). */
export function patchDeclaringProviderForm(
  patch: Partial<DeclaringDraftPersist>,
): void {
  if (state.kind !== 'declaring') return
  const next: DeclaringFormSession = {
    kind: 'declaring',
    route: patch.route !== undefined ? patch.route : state.route,
    displayName:
      patch.displayName !== undefined ? patch.displayName : state.displayName,
    baseURL: patch.baseURL !== undefined ? patch.baseURL : state.baseURL,
    proxy: patch.proxy !== undefined ? patch.proxy : state.proxy,
    protocol: patch.protocol !== undefined ? patch.protocol : state.protocol,
    keyDraft: patch.keyDraft !== undefined ? patch.keyDraft : state.keyDraft,
    models:
      patch.models !== undefined
        ? cloneModels(patch.models)
        : cloneModels(state.models),
  }
  if (
    next.route === state.route
    && next.displayName === state.displayName
    && next.baseURL === state.baseURL
    && next.proxy === state.proxy
    && next.protocol === state.protocol
    && next.keyDraft === state.keyDraft
    && sameJson(next.models, state.models)
  ) {
    return
  }
  replace(next)
}

/** Drop the draft (Cancel, successful write, or test reset). */
export function clearProviderFormSession(): void {
  if (state.kind === 'idle') return
  replace(IDLE)
}

/** Test-only reset. */
export function resetProviderFormSessionForTests(): void {
  state = IDLE
  emit()
}
