/**
 * Overview loaders: plan / Office / shared Status (`session.status` ≡ `/status`).
 * POST /sidebar/api/plan.preview → { ok, value: { active, pending } }
 * POST /office/connection.status → { result: { ok, value: { configured, connected } } }
 * POST /api/session.status → Face unary { result: { ok, value: SessionStatusView } }
 */

export interface PlanPreviewView {
  readonly active: boolean
  readonly pending: boolean
}

export interface OfficePreviewView {
  readonly configured: boolean
  readonly connected: boolean
}

/** Mirrors Face `SessionStatusSnapshot` (keep fields display-safe). */
export interface SessionStatusView {
  readonly sessionId: string
  readonly badge: string
  readonly permission: string
  readonly plan: 'on' | 'off'
  readonly theme: string
  readonly model: { readonly provider: string; readonly model: string }
  readonly cwd: string
  readonly events: number
  readonly jobs: readonly {
    readonly id: string
    readonly status: string
    readonly label?: string
  }[]
  readonly subagents: {
    readonly live: readonly {
      readonly id: string
      readonly label?: string
      readonly activity: 'running' | 'inactive'
      /**
       * Last-turn verdict. `activity: inactive` is shared by a finished child
       * and one the parent wait budget cut off.
       */
      readonly outcome?: {
        readonly kind:
          | 'completed'
          | 'aborted'
          | 'error'
          | 'max-tokens'
          | 'interrupted'
          | 'blocked'
          | 'none'
        readonly cause?: 'user' | 'parent' | 'disposed' | 'hook' | 'legacy'
        readonly quietMs?: number
      }
      readonly mode: string
      readonly model?: string
      readonly liveText?: string
      readonly liveTool?: string
      readonly queued?: number
      readonly steering?: number
      readonly externalKind?: 'acp' | 'app-server'
      readonly externalResume?: 'live' | 'cold'
    }[]
    readonly graph: {
      readonly nodes: readonly {
        readonly id: string
        readonly label: string
        readonly role?: string
        readonly depth?: number
        readonly activity?: 'running' | 'inactive'
      }[]
      readonly edges: readonly {
        readonly from: string
        readonly to: string
        readonly kind: string
        readonly label?: string
      }[]
    }
    readonly quota: {
      readonly depth: number
      readonly maxDepth: number
      readonly active: number
      readonly maxActive: number
      readonly delegated: number
      readonly slotsFree: number
    }
  }
  readonly teamTasks: readonly {
    readonly id: string
    readonly title: string
    readonly status: string
    readonly revision: number
    readonly childSessionId?: string
    readonly role?: string
    readonly humanOwned?: boolean
    readonly schemaValid?: boolean
    readonly worktreePath?: string
    readonly worktreeBranch?: string
    readonly worktreeId?: string
    readonly worktreeLeaseStatus?: string
    readonly resultPreview?: string
    readonly externalResume?: 'live' | 'cold'
  }[]
  readonly cost: {
    readonly input: number
    readonly output: number
    readonly cacheRead: number
    readonly cacheWrite: number
    readonly reasoning: number
    readonly cost: number
    readonly byModel: Readonly<Record<string, {
      readonly input: number
      readonly output: number
      readonly cacheRead: number
      readonly cacheWrite: number
      readonly reasoning: number
      readonly cost: number
    }>>
    readonly byProviderModel: Readonly<Record<string, {
      readonly input: number
      readonly output: number
      readonly cacheRead: number
      readonly cacheWrite: number
      readonly reasoning: number
      readonly cost: number
    }>>
  }
  /** Cross-session cost-meter ledger fold (today / month / top models). */
  readonly billing: {
    readonly todayCost: number
    readonly monthCost: number
    readonly totalCost: number
    readonly todayTokens: number
    readonly monthTokens: number
    readonly byModel: readonly {
      readonly key: string
      readonly input: number
      readonly output: number
      readonly cost: number
    }[]
    readonly byProviderModel: readonly {
      readonly key: string
      readonly input: number
      readonly output: number
      readonly cost: number
    }[]
    readonly dailyTrend: readonly {
      readonly date: string
      readonly cost: number
      readonly tokens: number
    }[]
  }
  /** Subagent / job / channel health glance. */
  readonly fleet: {
    readonly health: 'ok' | 'warn' | 'critical'
    readonly runningJobs: number
    readonly runningSubagents: number
    readonly slotsFree: number
    readonly queuedInbox: number
    readonly channelAlerts: number
    readonly alerts: readonly {
      readonly id: string
      readonly severity: 'info' | 'warn' | 'critical'
      readonly message: string
    }[]
  }
  /** Sticky Overview emotion ball from `presence_set` (optional). */
  readonly presence?: {
    readonly emotionId: string
    readonly tips?: string
    readonly source: 'tool'
    readonly updatedAt: number
  }
  /** Child 干员 ball — not the home Settings presence. */
  readonly companionBall?: {
    readonly shape: string
    readonly color: string
    readonly kit?: string
    readonly kitHat?: string
    readonly kitGlasses?: string
    readonly kitHeld?: string
    readonly overlayHat?: string
    readonly overlayGlasses?: string
    readonly overlayHeld?: string
  }
  readonly parentCompanionBall?: {
    readonly shape: string
    readonly color: string
    readonly kit?: string
    readonly kitHat?: string
    readonly kitGlasses?: string
    readonly kitHeld?: string
    readonly overlayHat?: string
    readonly overlayGlasses?: string
    readonly overlayHeld?: string
  }
  readonly parentPresence?: {
    readonly emotionId: string
    readonly tips?: string
    readonly source: 'tool'
    readonly updatedAt: number
  }
  readonly delegate?: {
    readonly parentSessionId: string
    readonly childLabel: string
    readonly parentLabel?: string
  }
  readonly timeline: {
    readonly total: number
    readonly system: number
    readonly tools: number
    readonly user: number
    readonly inject: number
    readonly assistant: number
    readonly tool: number
    readonly requestCount: number
    readonly eventCount: number
    readonly model?: string
    readonly provider?: string
    readonly contextWindow?: number
    readonly injectSources: readonly string[]
    readonly lastCompactReason?: 'auto' | 'overflow' | 'manual'
    readonly lastShadowedTokens?: number
    readonly spillCount: number
    readonly pruneCount: number
  }
  readonly compaction: {
    readonly pipeline: 'none' | 'prune' | 'summary' | 'prune→summary'
    readonly stages: readonly ('prune' | 'summary')[]
    readonly strategy?: 'prune-summary' | 'prune-only' | 'summary-only' | 'off'
    readonly lastReason?: 'auto' | 'overflow' | 'manual'
    readonly lastShadowedTokens?: number
    readonly pruneCount: number
    readonly summaryCount: number
    readonly spillCount: number
    readonly spillPaths?: readonly {
      readonly path: string
      readonly name: string
      readonly bytes?: number
      readonly preview?: string
      readonly tool?: string
    }[]
    readonly phase: 'idle' | 'busy'
  }
  readonly delivery: {
    readonly turnActive: boolean
    readonly queued: number
    readonly steering: number
    readonly compactBlockedByTurn: boolean
    readonly queueAcceptedWhileBusy: true
    readonly steerRequiresActiveTurn: true
    readonly note: string
  }
  /** Last curated-memory consolidate (Host pipeline; optional). */
  readonly curatedMemory?: {
    readonly sessionId: string
    readonly at: number
    readonly phase1Written: number
    readonly phase2: string
    readonly phase2Written: number
    readonly skipped?: string
    readonly providerKind?: string
  }
  readonly channels: {
    readonly process: readonly {
      readonly pluginId: string
      readonly channelId: string
      readonly displayName?: string
    }[]
    readonly im: readonly {
      readonly channelId: string
      readonly displayName: string
      readonly wired: string
    }[]
    readonly note: string
    readonly alerts: readonly {
      readonly id: string
      readonly severity: 'info' | 'warn' | 'critical'
      readonly message: string
    }[]
  }
}

export interface PreviewTabLoad {
  readonly plan: PlanPreviewView | null
  readonly office: OfficePreviewView | null
  readonly status: SessionStatusView | null
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parsePresenceLook(raw: unknown): SessionStatusView['companionBall'] {
  if (!raw || typeof raw !== 'object') return undefined
  const shape = str((raw as { shape?: unknown }).shape)
  const color = str((raw as { color?: unknown }).color)
  if (!shape || !color) return undefined
  const kit = str((raw as { kit?: unknown }).kit)
  const kitHat = str((raw as { kitHat?: unknown }).kitHat)
  const kitGlasses = str((raw as { kitGlasses?: unknown }).kitGlasses)
  const kitHeld = str((raw as { kitHeld?: unknown }).kitHeld)
  const overlayHat = str((raw as { overlayHat?: unknown }).overlayHat)
  const overlayGlasses = str((raw as { overlayGlasses?: unknown }).overlayGlasses)
  const overlayHeld = str((raw as { overlayHeld?: unknown }).overlayHeld)
  return {
    shape,
    color,
    ...(kit ? { kit } : {}),
    ...(kitHat ? { kitHat } : {}),
    ...(kitGlasses ? { kitGlasses } : {}),
    ...(kitHeld ? { kitHeld } : {}),
    ...(overlayHat ? { overlayHat } : {}),
    ...(overlayGlasses ? { overlayGlasses } : {}),
    ...(overlayHeld ? { overlayHeld } : {}),
  }
}

const LIVE_OUTCOME_KINDS = new Set([
  'completed',
  'aborted',
  'error',
  'max-tokens',
  'interrupted',
  'blocked',
  'none',
])
const LIVE_ABORT_CAUSES = new Set(['user', 'parent', 'disposed', 'hook', 'legacy'])

function parseLiveOutcome(
  raw: unknown,
): SessionStatusView['subagents']['live'][number]['outcome'] {
  if (!raw || typeof raw !== 'object') return undefined
  const kind = str((raw as { kind?: unknown }).kind)
  if (!kind || !LIVE_OUTCOME_KINDS.has(kind)) return undefined
  const causeRaw = str((raw as { cause?: unknown }).cause)
  const cause =
    kind === 'aborted' && causeRaw && LIVE_ABORT_CAUSES.has(causeRaw)
      ? (causeRaw as NonNullable<
        SessionStatusView['subagents']['live'][number]['outcome']
      >['cause'])
      : undefined
  const quietMs = num((raw as { quietMs?: unknown }).quietMs)
  return {
    kind: kind as NonNullable<
      SessionStatusView['subagents']['live'][number]['outcome']
    >['kind'],
    ...(cause ? { cause } : {}),
    ...(quietMs !== undefined ? { quietMs } : {}),
  }
}

/** Plan summary from the sidebar RPC envelope. Null when the body is not that shape. */
export function parsePlanPreview(body: unknown): PlanPreviewView | null {
  if (!body || typeof body !== 'object') return null
  const envelope = body as { ok?: unknown; value?: unknown }
  if (envelope.ok !== true || !envelope.value || typeof envelope.value !== 'object') return null
  const value = envelope.value as { active?: unknown; pending?: unknown }
  const active = bool(value.active)
  const pending = bool(value.pending)
  if (active === undefined || pending === undefined) return null
  return { active, pending }
}

/** Office status from the dsh-compat RPC envelope. Null when the body is not that shape. */
export function parseOfficePreview(body: unknown): OfficePreviewView | null {
  if (!body || typeof body !== 'object') return null
  const envelope = body as { result?: unknown }
  if (!envelope.result || typeof envelope.result !== 'object') return null
  const result = envelope.result as { ok?: unknown; value?: unknown }
  if (result.ok !== true || !result.value || typeof result.value !== 'object') return null
  const value = result.value as { configured?: unknown; connected?: unknown }
  const configured = bool(value.configured)
  const connected = bool(value.connected)
  if (configured === undefined || connected === undefined) return null
  return { configured, connected }
}

/** Face unary `session.status` envelope → structured Status (same as `/status`). */
export function parseSessionStatus(body: unknown): SessionStatusView | null {
  if (!body || typeof body !== 'object') return null
  const envelope = body as { result?: unknown }
  if (!envelope.result || typeof envelope.result !== 'object') return null
  const result = envelope.result as { ok?: unknown; value?: unknown }
  if (result.ok !== true || !result.value || typeof result.value !== 'object') return null
  const v = result.value as Record<string, unknown>
  const sessionId = str(v.sessionId)
  const badge = str(v.badge)
  const permission = str(v.permission)
  const plan = v.plan === 'on' || v.plan === 'off' ? v.plan : undefined
  const theme = str(v.theme)
  const cwd = str(v.cwd)
  const events = num(v.events)
  if (!sessionId || !badge || !permission || !plan || !theme || !cwd || events === undefined) {
    return null
  }
  const modelRaw = v.model
  if (!modelRaw || typeof modelRaw !== 'object') return null
  const provider = str((modelRaw as { provider?: unknown }).provider)
  const modelId = str((modelRaw as { model?: unknown }).model)
  if (!provider || !modelId) return null

  const jobs = Array.isArray(v.jobs)
    ? v.jobs.flatMap((row) => {
      if (!row || typeof row !== 'object') return []
      const id = str((row as { id?: unknown }).id)
      const status = str((row as { status?: unknown }).status)
      if (!id || !status) return []
      const label = str((row as { label?: unknown }).label)
      return [{ id, status, ...(label ? { label } : {}) }]
    })
    : []

  const subRaw = v.subagents
  if (!subRaw || typeof subRaw !== 'object') return null
  const liveRaw = (subRaw as { live?: unknown }).live
  const graphRaw = (subRaw as { graph?: unknown }).graph
  if (!Array.isArray(liveRaw) || !graphRaw || typeof graphRaw !== 'object') return null
  const live = liveRaw.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const id = str((row as { id?: unknown }).id)
    const activity = (row as { activity?: unknown }).activity
    const mode = str((row as { mode?: unknown }).mode)
    if (!id || (activity !== 'running' && activity !== 'inactive') || !mode) return []
    const label = str((row as { label?: unknown }).label)
    const outcome = parseLiveOutcome((row as { outcome?: unknown }).outcome)
    const model = str((row as { model?: unknown }).model)
    const liveText = str((row as { liveText?: unknown }).liveText)
    const liveTool = str((row as { liveTool?: unknown }).liveTool)
    const queued = num((row as { queued?: unknown }).queued)
    const steering = num((row as { steering?: unknown }).steering)
    const externalKindRaw = str((row as { externalKind?: unknown }).externalKind)
    const externalKind =
      externalKindRaw === 'acp' || externalKindRaw === 'app-server'
        ? externalKindRaw
        : undefined
    const externalResumeRaw = str((row as { externalResume?: unknown }).externalResume)
    const externalResume =
      externalResumeRaw === 'live' || externalResumeRaw === 'cold'
        ? externalResumeRaw
        : undefined
    return [{
      id,
      activity,
      mode,
      ...(outcome ? { outcome } : {}),
      ...(label ? { label } : {}),
      ...(model ? { model } : {}),
      ...(liveText ? { liveText } : {}),
      ...(liveTool ? { liveTool } : {}),
      ...(queued !== undefined && queued > 0 ? { queued } : {}),
      ...(steering !== undefined && steering > 0 ? { steering } : {}),
      ...(externalKind ? { externalKind } : {}),
      ...(externalResume ? { externalResume } : {}),
    }]
  })
  const nodesRaw = (graphRaw as { nodes?: unknown }).nodes
  const edgesRaw = (graphRaw as { edges?: unknown }).edges
  if (!Array.isArray(nodesRaw) || !Array.isArray(edgesRaw)) return null
  const nodes = nodesRaw.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const id = str((row as { id?: unknown }).id)
    const label = str((row as { label?: unknown }).label)
    if (!id || !label) return []
    const role = str((row as { role?: unknown }).role)
    return [{ id, label, ...(role ? { role } : {}) }]
  })
  const edges = edgesRaw.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const from = str((row as { from?: unknown }).from)
    const to = str((row as { to?: unknown }).to)
    const kind = str((row as { kind?: unknown }).kind)
    if (!from || !to || !kind) return []
    const label = str((row as { label?: unknown }).label)
    return [{ from, to, kind, ...(label ? { label } : {}) }]
  })
  const quotaRaw = (subRaw as { quota?: unknown }).quota
  const quotaObj = quotaRaw && typeof quotaRaw === 'object'
    ? (quotaRaw as Record<string, unknown>)
    : null
  const quota = {
    depth: num(quotaObj?.depth) ?? 0,
    maxDepth: num(quotaObj?.maxDepth) ?? 0,
    active: num(quotaObj?.active) ?? 0,
    maxActive: num(quotaObj?.maxActive) ?? 0,
    delegated: num(quotaObj?.delegated) ?? live.length,
    slotsFree: num(quotaObj?.slotsFree) ?? 0,
  }

  const costRaw = v.cost
  if (!costRaw || typeof costRaw !== 'object') return null
  const parseBuckets = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') {
      return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 }
    }
    const row = raw as Record<string, unknown>
    return {
      input: num(row.input) ?? 0,
      output: num(row.output) ?? 0,
      cacheRead: num(row.cacheRead) ?? 0,
      cacheWrite: num(row.cacheWrite) ?? 0,
      reasoning: num(row.reasoning) ?? 0,
      cost: num(row.cost) ?? 0,
    }
  }
  const parseBucketMap = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return {} as Record<string, ReturnType<typeof parseBuckets>>
    const out: Record<string, ReturnType<typeof parseBuckets>> = {}
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!key.trim()) continue
      out[key] = parseBuckets(value)
    }
    return out
  }
  const cost = {
    ...parseBuckets(costRaw),
    byModel: parseBucketMap((costRaw as { byModel?: unknown }).byModel),
    byProviderModel: parseBucketMap((costRaw as { byProviderModel?: unknown }).byProviderModel),
  }

  const billingRaw = v.billing
  const parseModelRows = (raw: unknown) => {
    if (!Array.isArray(raw)) return [] as SessionStatusView['billing']['byProviderModel']
    return raw.flatMap((row) => {
      if (!row || typeof row !== 'object') return []
      const key = str((row as { key?: unknown }).key)
      if (!key) return []
      return [{
        key,
        input: num((row as { input?: unknown }).input) ?? 0,
        output: num((row as { output?: unknown }).output) ?? 0,
        cost: num((row as { cost?: unknown }).cost) ?? 0,
      }]
    })
  }
  const billing: SessionStatusView['billing'] = billingRaw && typeof billingRaw === 'object'
    ? {
      todayCost: num((billingRaw as { todayCost?: unknown }).todayCost) ?? 0,
      monthCost: num((billingRaw as { monthCost?: unknown }).monthCost) ?? 0,
      totalCost: num((billingRaw as { totalCost?: unknown }).totalCost) ?? 0,
      todayTokens: num((billingRaw as { todayTokens?: unknown }).todayTokens) ?? 0,
      monthTokens: num((billingRaw as { monthTokens?: unknown }).monthTokens) ?? 0,
      byModel: [],
      byProviderModel: parseModelRows((billingRaw as { byProviderModel?: unknown }).byProviderModel),
      dailyTrend: Array.isArray((billingRaw as { dailyTrend?: unknown }).dailyTrend)
        ? (billingRaw as { dailyTrend: unknown[] }).dailyTrend.flatMap((row) => {
          if (!row || typeof row !== 'object') return []
          const date = str((row as { date?: unknown }).date)
          if (!date) return []
          return [{
            date,
            cost: num((row as { cost?: unknown }).cost) ?? 0,
            tokens: num((row as { tokens?: unknown }).tokens) ?? 0,
          }]
        })
        : [],
    }
    : {
      todayCost: 0,
      monthCost: 0,
      totalCost: 0,
      todayTokens: 0,
      monthTokens: 0,
      byModel: [],
      byProviderModel: [],
      dailyTrend: [],
    }

  const tlRaw = v.timeline
  if (!tlRaw || typeof tlRaw !== 'object') return null
  const injectSources = Array.isArray((tlRaw as { injectSources?: unknown }).injectSources)
    ? (tlRaw as { injectSources: unknown[] }).injectSources.flatMap((row) => {
      const s = str(row)
      return s ? [s] : []
    })
    : []
  const compactReason = (tlRaw as { lastCompactReason?: unknown }).lastCompactReason
  const lastCompactReason =
    compactReason === 'auto' || compactReason === 'overflow' || compactReason === 'manual'
      ? compactReason
      : undefined
  const lastShadowedTokens = num((tlRaw as { lastShadowedTokens?: unknown }).lastShadowedTokens)
  const timeline = {
    total: num((tlRaw as { total?: unknown }).total) ?? 0,
    system: num((tlRaw as { system?: unknown }).system) ?? 0,
    tools: num((tlRaw as { tools?: unknown }).tools) ?? 0,
    user: num((tlRaw as { user?: unknown }).user) ?? 0,
    inject: num((tlRaw as { inject?: unknown }).inject) ?? 0,
    assistant: num((tlRaw as { assistant?: unknown }).assistant) ?? 0,
    tool: num((tlRaw as { tool?: unknown }).tool) ?? 0,
    requestCount: num((tlRaw as { requestCount?: unknown }).requestCount) ?? 0,
    eventCount: num((tlRaw as { eventCount?: unknown }).eventCount) ?? 0,
    injectSources,
    spillCount: num((tlRaw as { spillCount?: unknown }).spillCount) ?? 0,
    pruneCount: num((tlRaw as { pruneCount?: unknown }).pruneCount) ?? 0,
    ...(str((tlRaw as { model?: unknown }).model)
      ? { model: str((tlRaw as { model?: unknown }).model) }
      : {}),
    ...(str((tlRaw as { provider?: unknown }).provider)
      ? { provider: str((tlRaw as { provider?: unknown }).provider) }
      : {}),
    ...(num((tlRaw as { contextWindow?: unknown }).contextWindow) !== undefined
      ? { contextWindow: num((tlRaw as { contextWindow?: unknown }).contextWindow) }
      : {}),
    ...(lastCompactReason ? { lastCompactReason } : {}),
    ...(lastShadowedTokens !== undefined ? { lastShadowedTokens } : {}),
  }

  const compactionRaw = v.compaction
  const compactionPipelineRaw =
    compactionRaw && typeof compactionRaw === 'object'
      ? str((compactionRaw as { pipeline?: unknown }).pipeline)
      : undefined
  const compactionPipeline =
    compactionPipelineRaw === 'prune'
    || compactionPipelineRaw === 'summary'
    || compactionPipelineRaw === 'prune→summary'
    || compactionPipelineRaw === 'none'
      ? compactionPipelineRaw
      : 'none'
  const compactionStagesRaw =
    compactionRaw && typeof compactionRaw === 'object'
    && Array.isArray((compactionRaw as { stages?: unknown }).stages)
      ? (compactionRaw as { stages: unknown[] }).stages
      : []
  const compactionStages = compactionStagesRaw.flatMap((row) =>
    row === 'prune' || row === 'summary' ? [row] : [],
  )
  const compactionReasonRaw =
    compactionRaw && typeof compactionRaw === 'object'
      ? (compactionRaw as { lastReason?: unknown }).lastReason
      : undefined
  const compactionLastReason =
    compactionReasonRaw === 'auto'
    || compactionReasonRaw === 'overflow'
    || compactionReasonRaw === 'manual'
      ? compactionReasonRaw
      : lastCompactReason
  const compactionShadowed =
    compactionRaw && typeof compactionRaw === 'object'
      ? num((compactionRaw as { lastShadowedTokens?: unknown }).lastShadowedTokens)
      : lastShadowedTokens
  const compactionPhaseRaw =
    compactionRaw && typeof compactionRaw === 'object'
      ? str((compactionRaw as { phase?: unknown }).phase)
      : undefined
  const strategyRaw =
    compactionRaw && typeof compactionRaw === 'object'
      ? str((compactionRaw as { strategy?: unknown }).strategy)
      : undefined
  const strategy =
    strategyRaw === 'prune-summary'
    || strategyRaw === 'prune-only'
    || strategyRaw === 'summary-only'
    || strategyRaw === 'off'
      ? strategyRaw
      : undefined
  const spillPathsRaw =
    compactionRaw && typeof compactionRaw === 'object'
    && Array.isArray((compactionRaw as { spillPaths?: unknown }).spillPaths)
      ? (compactionRaw as { spillPaths: unknown[] }).spillPaths
      : []
  const spillPaths = spillPathsRaw.flatMap((row) => {
    if (typeof row === 'string') {
      const p = str(row)
      if (!p) return []
      const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
      const name = slash >= 0 ? p.slice(slash + 1) : p
      return [{ path: p, name: name || p }]
    }
    if (!row || typeof row !== 'object') return []
    const path = str((row as { path?: unknown }).path)
    if (!path) return []
    const name = str((row as { name?: unknown }).name) || path
    const bytes = num((row as { bytes?: unknown }).bytes)
    const preview = str((row as { preview?: unknown }).preview)
    const tool = str((row as { tool?: unknown }).tool)
    return [{
      path,
      name,
      ...(bytes !== undefined ? { bytes } : {}),
      ...(preview ? { preview } : {}),
      ...(tool ? { tool } : {}),
    }]
  })
  const compaction: SessionStatusView['compaction'] = {
    pipeline: compactionPipeline,
    stages: compactionStages.length > 0
      ? compactionStages
      : compactionPipeline === 'prune→summary'
        ? ['prune', 'summary']
        : compactionPipeline === 'prune'
          ? ['prune']
          : compactionPipeline === 'summary'
            ? ['summary']
            : [],
    ...(strategy ? { strategy } : {}),
    ...(compactionLastReason ? { lastReason: compactionLastReason } : {}),
    ...(compactionShadowed !== undefined
      ? { lastShadowedTokens: compactionShadowed }
      : {}),
    pruneCount:
      (compactionRaw && typeof compactionRaw === 'object'
        ? num((compactionRaw as { pruneCount?: unknown }).pruneCount)
        : undefined) ?? timeline.pruneCount,
    summaryCount:
      (compactionRaw && typeof compactionRaw === 'object'
        ? num((compactionRaw as { summaryCount?: unknown }).summaryCount)
        : undefined) ?? 0,
    spillCount:
      (compactionRaw && typeof compactionRaw === 'object'
        ? num((compactionRaw as { spillCount?: unknown }).spillCount)
        : undefined) ?? timeline.spillCount,
    ...(spillPaths.length > 0 ? { spillPaths } : {}),
    phase: compactionPhaseRaw === 'busy' ? 'busy' : 'idle',
  }

  const deliveryRaw = v.delivery
  const delivery: SessionStatusView['delivery'] = {
    turnActive: Boolean(
      deliveryRaw
      && typeof deliveryRaw === 'object'
      && (deliveryRaw as { turnActive?: unknown }).turnActive === true,
    ),
    queued:
      (deliveryRaw && typeof deliveryRaw === 'object'
        ? num((deliveryRaw as { queued?: unknown }).queued)
        : undefined) ?? 0,
    steering:
      (deliveryRaw && typeof deliveryRaw === 'object'
        ? num((deliveryRaw as { steering?: unknown }).steering)
        : undefined) ?? 0,
    compactBlockedByTurn: Boolean(
      deliveryRaw
      && typeof deliveryRaw === 'object'
      && (deliveryRaw as { compactBlockedByTurn?: unknown }).compactBlockedByTurn === true,
    ),
    queueAcceptedWhileBusy: true,
    steerRequiresActiveTurn: true,
    note:
      (deliveryRaw && typeof deliveryRaw === 'object'
        ? str((deliveryRaw as { note?: unknown }).note)
        : undefined) ?? 'idle · queue accepts · compact available when agent idle',
  }

  const chRaw = v.channels
  if (!chRaw || typeof chRaw !== 'object') return null
  const processRaw = (chRaw as { process?: unknown }).process
  const imRaw = (chRaw as { im?: unknown }).im
  const note = str((chRaw as { note?: unknown }).note) ?? ''
  if (!Array.isArray(processRaw) || !Array.isArray(imRaw)) return null
  const process = processRaw.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const pluginId = str((row as { pluginId?: unknown }).pluginId)
    const channelId = str((row as { channelId?: unknown }).channelId)
    if (!pluginId || !channelId) return []
    const displayName = str((row as { displayName?: unknown }).displayName)
    return [{ pluginId, channelId, ...(displayName ? { displayName } : {}) }]
  })
  const im = imRaw.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const channelId = str((row as { channelId?: unknown }).channelId)
    const displayName = str((row as { displayName?: unknown }).displayName)
    const wired = str((row as { wired?: unknown }).wired)
    if (!channelId || !displayName || !wired) return []
    return [{ channelId, displayName, wired }]
  })
  const parseAlerts = (raw: unknown) => {
    if (!Array.isArray(raw)) return [] as SessionStatusView['fleet']['alerts']
    return raw.flatMap((row) => {
      if (!row || typeof row !== 'object') return []
      const id = str((row as { id?: unknown }).id)
      const message = str((row as { message?: unknown }).message)
      const severity = str((row as { severity?: unknown }).severity)
      if (!id || !message) return []
      if (severity !== 'info' && severity !== 'warn' && severity !== 'critical') return []
      return [{ id, severity, message }]
    })
  }
  const channelAlerts = parseAlerts((chRaw as { alerts?: unknown }).alerts)

  const fleetRaw = v.fleet
  const fleetHealthRaw = fleetRaw && typeof fleetRaw === 'object'
    ? str((fleetRaw as { health?: unknown }).health)
    : undefined
  const fleet: SessionStatusView['fleet'] = fleetRaw && typeof fleetRaw === 'object'
    ? {
      health:
        fleetHealthRaw === 'warn' || fleetHealthRaw === 'critical'
          ? fleetHealthRaw
          : 'ok',
      runningJobs: num((fleetRaw as { runningJobs?: unknown }).runningJobs) ?? 0,
      runningSubagents: num((fleetRaw as { runningSubagents?: unknown }).runningSubagents) ?? 0,
      slotsFree: num((fleetRaw as { slotsFree?: unknown }).slotsFree) ?? 0,
      queuedInbox: num((fleetRaw as { queuedInbox?: unknown }).queuedInbox) ?? 0,
      channelAlerts: num((fleetRaw as { channelAlerts?: unknown }).channelAlerts) ?? channelAlerts.length,
      alerts: parseAlerts((fleetRaw as { alerts?: unknown }).alerts),
    }
    : {
      health: 'ok',
      runningJobs: 0,
      runningSubagents: 0,
      slotsFree: 0,
      queuedInbox: 0,
      channelAlerts: channelAlerts.length,
      alerts: channelAlerts,
    }

  const presenceRaw = v.presence
  let presence: SessionStatusView['presence']
  if (presenceRaw && typeof presenceRaw === 'object') {
    const emotionId = str((presenceRaw as { emotionId?: unknown }).emotionId)
    const updatedAt = num((presenceRaw as { updatedAt?: unknown }).updatedAt)
    const source = str((presenceRaw as { source?: unknown }).source)
    if (emotionId && updatedAt !== undefined && source === 'tool') {
      const tips = str((presenceRaw as { tips?: unknown }).tips)
      presence = {
        emotionId,
        source: 'tool',
        updatedAt,
        ...(tips ? { tips } : {}),
      }
    }
  }

  const teamTasksRaw = v.teamTasks
  const teamTasks = Array.isArray(teamTasksRaw)
    ? teamTasksRaw.flatMap((row) => {
      if (!row || typeof row !== 'object') return []
      const id = str((row as { id?: unknown }).id)
      const title = str((row as { title?: unknown }).title)
      const status = str((row as { status?: unknown }).status)
      const revision = num((row as { revision?: unknown }).revision) ?? 0
      if (!id || !title || !status) return []
      const childSessionId = str((row as { childSessionId?: unknown }).childSessionId)
      const role = str((row as { role?: unknown }).role)
      const humanOwned = bool((row as { humanOwned?: unknown }).humanOwned)
      const schemaValid = bool((row as { schemaValid?: unknown }).schemaValid)
      const worktreePath = str((row as { worktreePath?: unknown }).worktreePath)
      const worktreeBranch = str((row as { worktreeBranch?: unknown }).worktreeBranch)
      const worktreeId = str((row as { worktreeId?: unknown }).worktreeId)
      const worktreeLeaseStatus = str((row as { worktreeLeaseStatus?: unknown }).worktreeLeaseStatus)
      const resultPreview = str((row as { resultPreview?: unknown }).resultPreview)
      const externalResumeRaw = str((row as { externalResume?: unknown }).externalResume)
      const externalResume =
        externalResumeRaw === 'live' || externalResumeRaw === 'cold'
          ? externalResumeRaw
          : undefined
      return [{
        id,
        title,
        status,
        revision,
        ...(childSessionId ? { childSessionId } : {}),
        ...(role ? { role } : {}),
        ...(humanOwned ? { humanOwned: true } : {}),
        ...(schemaValid !== undefined ? { schemaValid } : {}),
        ...(worktreePath ? { worktreePath } : {}),
        ...(worktreeBranch ? { worktreeBranch } : {}),
        ...(worktreeId ? { worktreeId } : {}),
        ...(worktreeLeaseStatus ? { worktreeLeaseStatus } : {}),
        ...(resultPreview ? { resultPreview } : {}),
        ...(externalResume ? { externalResume } : {}),
      }]
    })
    : []

  const curatedRaw = v.curatedMemory
  let curatedMemory: SessionStatusView['curatedMemory']
  if (curatedRaw && typeof curatedRaw === 'object') {
    const sessionIdMem = str((curatedRaw as { sessionId?: unknown }).sessionId)
    const at = num((curatedRaw as { at?: unknown }).at)
    const phase1Written = num((curatedRaw as { phase1Written?: unknown }).phase1Written)
    const phase2 = str((curatedRaw as { phase2?: unknown }).phase2)
    const phase2Written = num((curatedRaw as { phase2Written?: unknown }).phase2Written)
    if (sessionIdMem && at !== undefined && phase1Written !== undefined && phase2 && phase2Written !== undefined) {
      const skipped = str((curatedRaw as { skipped?: unknown }).skipped)
      const providerKind = str((curatedRaw as { providerKind?: unknown }).providerKind)
      curatedMemory = {
        sessionId: sessionIdMem,
        at,
        phase1Written,
        phase2,
        phase2Written,
        ...(skipped ? { skipped } : {}),
        ...(providerKind ? { providerKind } : {}),
      }
    }
  }

  const companionBall = parsePresenceLook(v.companionBall)
  const parentCompanionBall = parsePresenceLook(v.parentCompanionBall)
  const parentPresenceRaw = v.parentPresence
  let parentPresence: SessionStatusView['parentPresence']
  if (parentPresenceRaw && typeof parentPresenceRaw === 'object') {
    const emotionId = str((parentPresenceRaw as { emotionId?: unknown }).emotionId)
    const updatedAt = num((parentPresenceRaw as { updatedAt?: unknown }).updatedAt)
    const source = str((parentPresenceRaw as { source?: unknown }).source)
    if (emotionId && updatedAt !== undefined && source === 'tool') {
      const tips = str((parentPresenceRaw as { tips?: unknown }).tips)
      parentPresence = {
        emotionId,
        source: 'tool',
        updatedAt,
        ...(tips ? { tips } : {}),
      }
    }
  }
  const delegateRaw = v.delegate
  let delegate: SessionStatusView['delegate']
  if (delegateRaw && typeof delegateRaw === 'object') {
    const parentSessionId = str((delegateRaw as { parentSessionId?: unknown }).parentSessionId)
    const childLabel = str((delegateRaw as { childLabel?: unknown }).childLabel)
    const parentLabel = str((delegateRaw as { parentLabel?: unknown }).parentLabel)
    if (parentSessionId && childLabel) {
      delegate = {
        parentSessionId,
        childLabel,
        ...(parentLabel ? { parentLabel } : {}),
      }
    }
  }

  return {
    sessionId,
    badge,
    permission,
    plan,
    theme,
    model: { provider, model: modelId },
    cwd,
    events,
    jobs,
    subagents: { live, graph: { nodes, edges }, quota },
    teamTasks,
    cost,
    billing,
    fleet,
    ...(presence ? { presence } : {}),
    ...(companionBall ? { companionBall } : {}),
    ...(parentCompanionBall ? { parentCompanionBall } : {}),
    ...(parentPresence ? { parentPresence } : {}),
    ...(delegate ? { delegate } : {}),
    timeline,
    compaction,
    delivery,
    ...(curatedMemory ? { curatedMemory } : {}),
    channels: { process, im, note, alerts: channelAlerts },
  }
}

/** Face unary `session.status` only (presence dock / light poll). */
export async function loadSessionStatus(
  sessionId: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  rpcId = 'presence-dock-status',
): Promise<SessionStatusView | null> {
  const statusBody = await fetchImpl('/api/session.status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      payload: { sessionId },
    }),
  }).then(async (res) => res.json() as Promise<unknown>).catch(() => null)
  return parseSessionStatus(statusBody)
}

/** Fetch plan · Office · Status. A failed request becomes null; other tabs still render. */
export async function loadPreviewTabs(
  sessionId: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<PreviewTabLoad> {
  const [planBody, officeBody, status] = await Promise.all([
    fetchImpl('/sidebar/api/plan.preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).then(async (res) => res.json() as Promise<unknown>).catch(() => null),
    fetchImpl('/office/connection.status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'preview-tabs',
        method: 'connection.status',
        payload: {},
      }),
    }).then(async (res) => res.json() as Promise<unknown>).catch(() => null),
    loadSessionStatus(sessionId, fetchImpl, 'preview-status'),
  ])
  return {
    plan: parsePlanPreview(planBody),
    office: parseOfficePreview(officeBody),
    status,
  }
}
