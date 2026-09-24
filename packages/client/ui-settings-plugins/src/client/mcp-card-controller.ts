/** The MCP card's staged form over the `mcp` settings namespace. */

import type { IApiClient } from '@xrkseek/client-connection/client'
import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@xrkseek/client-runtime/client'
import { createSnapshotStore } from '@xrkseek/client-runtime/client'
import type { CardActions, CardShell } from './card-form.ts'

/** Namespace of the MCP desired-servers draft. */
export const MCP_NS = 'mcp'

/** Live supervisor health from a mounted MCP plugin. */
export type McpLiveStatus = 'connected' | 'reconnecting' | 'gave-up'

/** Row status shown next to each desired server. */
export type McpRowStatus = McpLiveStatus | 'parked' | 'failed' | 'idle'

/** One live MCP plugin the Host reports in the connected overlay. */
export interface McpConnectedEntry {
  readonly id: string
  readonly serverName: string
  readonly kind: string
  readonly toolCount: number
  /** Supervisor health; omitted on older Hosts. */
  readonly status?: McpLiveStatus
}

/** Host-served MCP namespace value (desired + overlay). */
export interface McpSettings {
  readonly servers?: readonly McpServerDraft[]
  readonly allowConnect?: boolean
  readonly connected?: readonly McpConnectedEntry[]
  readonly parked?: readonly string[]
  readonly connectFailures?: readonly { readonly serverName: string; readonly message: string }[]
  readonly note?: string
}

/** One desired server row persisted to host-settings.json. */
export interface McpServerDraft {
  readonly serverName: string
  readonly command?: string
  readonly url?: string
  readonly args?: readonly string[]
  readonly cwd?: string
  /** Acknowledge workspace litter when `cwd` is under the Host workspace. */
  readonly cwdAllowWorkspace?: boolean
}

/** Transport kind the card edits for one row. */
export type McpTransport = 'stdio' | 'http'

/** OAuth login phase for an HTTP MCP server (device-code). */
export type McpOauthPhase = 'idle' | 'pending' | 'logged-in' | 'error' | 'cancelled' | 'unknown'

/** Per-server OAuth overlay (no secrets). */
export interface McpOauthRowState {
  readonly phase: McpOauthPhase
  readonly loggedIn: boolean
  readonly expired?: boolean
  readonly userCode?: string
  readonly verificationUri?: string
  readonly verificationUriComplete?: string
  readonly error?: string
  readonly busy?: boolean
}

/** One editable row in the card UI. */
export interface McpServerRow {
  readonly serverName: string
  readonly transport: McpTransport
  readonly command: string
  readonly url: string
  /** Comma-separated args in the editor. */
  readonly args: string
  readonly cwd: string
  /** Staged ack for workspace cwd (saved as cwdAllowWorkspace). */
  readonly cwdAllowWorkspace: boolean
  /** Derived live status for this desired name. */
  readonly status: McpRowStatus
  /** Tool count when connected; otherwise 0. */
  readonly toolCount: number
  /** Failure message when status is failed. */
  readonly failureMessage?: string
  /** OAuth overlay for HTTP rows (absent for stdio). */
  readonly oauth?: McpOauthRowState
}

/** What the MCP card renders. */
export interface McpCardState extends CardShell {
  /** Desired server rows staged for save. */
  readonly rows: readonly McpServerRow[]
  /** Whether MCP connect is allowed (Web Settings). */
  readonly allowConnect: boolean
  /** Face note; read-only. */
  readonly note: string
  /** Whether any row fails client-side validation. */
  readonly rowInvalid: boolean
  /** True when a staged stdio row has cwd but no workspace ack. */
  readonly cwdNeedsAck: boolean
  /** Show field errors only after a blocked save. */
  readonly showErrors: boolean
}

/** Result of merging a paste into the staged list. */
export type McpPasteResult = 'ok' | 'empty' | 'invalid'

/** The registration-side face the MCP card's slot entry injects. */
export interface McpCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useMcpCard. */
    mcpCard: SnapshotStore<McpCardState>
  }
  /** @deprecated Form editing removed; JSON paste only. */
  editRow: (index: number, patch: Partial<McpServerRow>) => void
  /**
   * Merge a Cursor/Trae `{ mcpServers }` JSON block into the staged list
   * (upsert by server name). Empty / invalid paste does not add a blank row.
   */
  addRow: (paste?: string) => McpPasteResult
  /** Remove a staged row. */
  removeRow: (index: number) => void
  /** Stage Allow connect (saved with the server list). */
  setAllowConnect: (allow: boolean) => void
  /**
   * Acknowledge workspace cwd risk for staged rows that set `cwd`.
   * Required before save when any stdio row has an explicit cwd without
   * `cwdAllowWorkspace`.
   */
  setAllowWorkspaceCwd: (allow: boolean) => void
  /** Start device-code OAuth for an HTTP server row (same path as `xrkh mcp login`). */
  loginOauth: (serverName: string) => void
  /** Clear the on-disk OAuth token for a server. */
  logoutOauth: (serverName: string) => void
}

/** Bridges the `mcp` scope onto the card's staged server list. */
export class McpCardController {
  private readonly store: SnapshotStore<McpCardState>
  private rows: McpServerRow[] = []
  private allowConnect = false
  /** True after the user toggles Allow connect (so save respects an explicit park). */
  private allowTouched = false
  /**
   * True while the card holds local edits the user has not saved/discarded.
   * Distinct from `dirty()`: an external `settings.mutate` also makes local≠scope,
   * but that must reseed — not freeze an empty draft as「未保存」.
   */
  private userStaged = false
  private seeded = false
  private saving = false
  private failed = false
  private showErrors = false
  private oauthByServer = new Map<string, McpOauthRowState>()
  private oauthPollTimer: ReturnType<typeof setInterval> | undefined
  private oauthBusy = new Set<string>()

  /**
   * @param scope - the bound settings scope for the `mcp` namespace.
   * @param api - wire face for mcp.oauth.* (optional in unit tests).
   */
  constructor(
    private readonly scope: SettingsScope<McpSettings>,
    private readonly api?: Pick<IApiClient, 'mcpOauth'>,
  ) {
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => { this.syncFromScope() })
    this.syncFromScope(true)
  }

  private syncFromScope(force = false): void {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready') {
      this.seeded = false
      this.publish()
      return
    }
    // Reseed when never seeded, forced, or the user has no local draft.
    // Do not use dirty() here: agent/UI mutate updates the scope and would
    // look "dirty" against a stale empty seed, then skip reseed forever.
    if (!this.seeded || force || !this.userStaged) {
      this.rows = serversOf(snapshot).map(draft => rowToUi(draft, snapshot, this.oauthByServer))
      this.allowConnect = allowOf(snapshot)
      this.allowTouched = false
      this.userStaged = false
      this.seeded = true
      this.failed = false
      this.showErrors = false
    } else {
      // Refresh live status overlays without clobbering staged edits.
      this.rows = this.rows.map(row => enrichRowStatus(row, snapshot, this.oauthByServer))
    }
    this.publish()
    void this.refreshOauthStatus()
  }

  private projection(): McpCardState {
    const snapshot = this.scope.getSnapshot()
    const invalid = this.rows.some(row => validateRow(row) !== undefined)
    const cwdNeedsAck = this.rows.some(
      row => row.transport === 'stdio' && row.cwd.trim() && !row.cwdAllowWorkspace,
    )
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.dirty(),
      invalid: invalid || cwdNeedsAck,
      rowInvalid: invalid,
      cwdNeedsAck,
      showErrors: this.showErrors && (invalid || cwdNeedsAck),
      saving: this.saving,
      failed: this.failed,
      rows: this.rows.map(row => enrichRowOauth(row, this.oauthByServer, this.oauthBusy)),
      allowConnect: this.allowConnect,
      note: noteOf(snapshot),
    }
  }

  private contentDiffers(): boolean {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready') return false
    if (this.allowConnect !== allowOf(snapshot)) return true
    return JSON.stringify(this.rows.map(rowFromUi)) !== JSON.stringify(serversOf(snapshot))
  }

  private dirty(): boolean {
    return this.seeded && this.userStaged && this.contentDiffers()
  }

  /** Mark a local edit; drop the staged flag when the draft matches scope again. */
  private touchLocal(): void {
    this.userStaged = true
    if (!this.contentDiffers()) this.userStaged = false
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  /** @returns the card's snapshot and its form actions. */
  inject(): McpCardFace {
    return {
      hooks: { mcpCard: this.store },
      editRow: (index, patch) => { this.editRow(index, patch) },
      addRow: (paste) => this.addRow(paste),
      removeRow: (index) => { this.removeRow(index) },
      setAllowConnect: (allow) => { this.setAllowConnect(allow) },
      setAllowWorkspaceCwd: (allow) => { this.setAllowWorkspaceCwd(allow) },
      loginOauth: (serverName) => { void this.loginOauth(serverName) },
      logoutOauth: (serverName) => { void this.logoutOauth(serverName) },
      edit: () => { /* rows use paste merge */ },
      resetField: () => { /* n/a for MCP list */ },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  private httpServerNames(): string[] {
    const names = new Set<string>()
    for (const row of this.rows) {
      if (row.transport === 'http' && row.serverName.trim()) names.add(row.serverName.trim())
    }
    const snapshot = this.scope.getSnapshot()
    for (const draft of serversOf(snapshot)) {
      if (draft.url && draft.serverName.trim()) names.add(draft.serverName.trim())
    }
    return [...names]
  }

  private async refreshOauthStatus(): Promise<void> {
    if (!this.api) return
    const servers = this.httpServerNames()
    if (servers.length === 0) {
      this.stopOauthPoll()
      if (this.oauthByServer.size > 0) {
        this.oauthByServer.clear()
        this.publish()
      }
      return
    }
    let response: Awaited<ReturnType<IApiClient['mcpOauth']['status']>>
    try {
      response = await this.api.mcpOauth.status({ servers })
    } catch {
      return
    }
    if (!response.result.ok) return
    const next = new Map<string, McpOauthRowState>()
    let pending = false
    for (const item of response.result.value.items) {
      const phase = item.loginPhase
      if (phase === 'pending') pending = true
      next.set(item.server, {
        phase,
        loggedIn: item.loggedIn,
        ...(item.expired !== undefined ? { expired: item.expired } : {}),
        ...(item.userCode ? { userCode: item.userCode } : {}),
        ...(item.verificationUri ? { verificationUri: item.verificationUri } : {}),
        ...(item.verificationUriComplete
          ? { verificationUriComplete: item.verificationUriComplete }
          : {}),
        ...(item.loginError ? { error: item.loginError } : {}),
      })
    }
    this.oauthByServer = next
    if (pending) this.startOauthPoll()
    else this.stopOauthPoll()
    this.publish()
  }

  private startOauthPoll(): void {
    if (this.oauthPollTimer !== undefined || !this.api) return
    this.oauthPollTimer = setInterval(() => { void this.refreshOauthStatus() }, 2000)
  }

  private stopOauthPoll(): void {
    if (this.oauthPollTimer === undefined) return
    clearInterval(this.oauthPollTimer)
    this.oauthPollTimer = undefined
  }

  private async loginOauth(serverName: string): Promise<void> {
    if (!this.api) return
    const name = serverName.trim()
    if (!name || this.oauthBusy.has(name)) return
    const row = this.rows.find(r => r.serverName === name && r.transport === 'http')
    this.oauthBusy.add(name)
    this.publish()
    let response: Awaited<ReturnType<IApiClient['mcpOauth']['login']>>
    try {
      response = await this.api.mcpOauth.login({
        server: name,
        ...(row?.url.trim() ? { url: row.url.trim() } : {}),
      })
    } catch (err) {
      this.oauthByServer.set(name, {
        phase: 'error',
        loggedIn: false,
        error: err instanceof Error ? err.message : String(err),
      })
      this.oauthBusy.delete(name)
      this.publish()
      return
    }
    this.oauthBusy.delete(name)
    if (!response.result.ok) {
      this.oauthByServer.set(name, {
        phase: 'error',
        loggedIn: false,
        error: response.result.error.message,
      })
      this.publish()
      return
    }
    const value = response.result.value
    if (value.status === 'logged-in') {
      this.oauthByServer.set(name, { phase: 'logged-in', loggedIn: true })
    } else {
      this.oauthByServer.set(name, {
        phase: 'pending',
        loggedIn: false,
        ...(value.userCode ? { userCode: value.userCode } : {}),
        ...(value.verificationUri ? { verificationUri: value.verificationUri } : {}),
        ...(value.verificationUriComplete
          ? { verificationUriComplete: value.verificationUriComplete }
          : {}),
      })
      this.startOauthPoll()
    }
    this.publish()
    void this.refreshOauthStatus()
  }

  private async logoutOauth(serverName: string): Promise<void> {
    if (!this.api) return
    const name = serverName.trim()
    if (!name || this.oauthBusy.has(name)) return
    this.oauthBusy.add(name)
    this.publish()
    try {
      await this.api.mcpOauth.logout({ server: name })
    } catch {
      /* status refresh surfaces the outcome */
    }
    this.oauthBusy.delete(name)
    this.oauthByServer.set(name, { phase: 'idle', loggedIn: false })
    this.publish()
    void this.refreshOauthStatus()
  }

  private setAllowConnect(allow: boolean): void {
    this.allowConnect = allow
    this.allowTouched = true
    this.touchLocal()
    this.failed = false
    this.publish()
  }

  private setAllowWorkspaceCwd(allow: boolean): void {
    this.rows = this.rows.map((row) => {
      if (row.transport !== 'stdio' || !row.cwd.trim()) return row
      return { ...row, cwdAllowWorkspace: allow }
    })
    this.touchLocal()
    this.failed = false
    if (!this.rows.some(r => validateRow(r) !== undefined)
      && !this.rows.some(r => r.transport === 'stdio' && r.cwd.trim() && !r.cwdAllowWorkspace)) {
      this.showErrors = false
    }
    this.publish()
  }

  private editRow(index: number, patch: Partial<McpServerRow>): void {
    const row = this.rows[index]
    if (row === undefined) return
    let next: McpServerRow = { ...row, ...patch }
    if (patch.transport !== undefined && patch.transport !== row.transport) {
      next = patch.transport === 'http'
        ? { ...next, command: '', args: '', cwd: '', cwdAllowWorkspace: false }
        : { ...next, url: '' }
    }
    this.rows = this.rows.with(index, next)
    this.touchLocal()
    this.failed = false
    if (!this.rows.some(r => validateRow(r) !== undefined)) this.showErrors = false
    this.publish()
  }

  private addRow(paste?: string): McpPasteResult {
    const raw = typeof paste === 'string' ? paste.trim() : ''
    if (!raw) return 'empty'
    const imported = rowsFromMcpPaste(raw)
    if (imported.length === 0) return 'invalid'
    const snapshot = this.scope.getSnapshot()
    this.rows = mergeRowsByName(this.rows, imported).map(row =>
      enrichRowStatus(row, snapshot, this.oauthByServer))
    // Paste implies connect (DSH: configured servers come up live).
    this.allowConnect = true
    this.touchLocal()
    this.failed = false
    this.publish()
    void this.refreshOauthStatus()
    return 'ok'
  }

  private removeRow(index: number): void {
    if (index < 0 || index >= this.rows.length) return
    this.rows = this.rows.toSpliced(index, 1)
    if (this.rows.length === 0) {
      this.allowConnect = false
      this.allowTouched = false
    }
    this.touchLocal()
    this.failed = false
    if (!this.rows.some(r => validateRow(r) !== undefined)) this.showErrors = false
    this.publish()
  }

  private discard(): void {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready') return
    this.rows = serversOf(snapshot).map(draft => rowToUi(draft, snapshot, this.oauthByServer))
    this.allowConnect = allowOf(snapshot)
    this.allowTouched = false
    this.userStaged = false
    this.failed = false
    this.showErrors = false
    this.publish()
  }

  private async save(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable || this.saving) return
    const rowBad = this.rows.some(row => validateRow(row) !== undefined)
    const cwdNeedsAck = this.rows.some(
      row => row.transport === 'stdio' && row.cwd.trim() && !row.cwdAllowWorkspace,
    )
    if (rowBad || cwdNeedsAck) {
      this.showErrors = true
      this.publish()
      return
    }
    if (!this.dirty()) return
    this.saving = true
    this.failed = false
    this.showErrors = false
    this.publish()
    const payload = this.rows.map(rowFromUi)
    // Empty → park. Non-empty → connect unless the user turned Allow off.
    // If they never touched the toggle, saving a non-empty list connects (填完就连).
    const wantAllow = payload.length === 0
      ? false
      : this.allowTouched
        ? this.allowConnect
        : true
    this.allowConnect = wantAllow
    // Allow first so the servers reconcile sees the new gate.
    await this.scope.set('allowConnect', wantAllow)
    await this.scope.set('servers', payload)
    const after = this.scope.getSnapshot()
    const landed = after.status === 'ready'
      && allowOf(after) === wantAllow
      && JSON.stringify(serversOf(after)) === JSON.stringify(payload)
    this.saving = false
    this.failed = !landed
    if (landed) {
      this.seeded = true
      this.allowTouched = false
      this.userStaged = false
      this.rows = serversOf(after).map(draft => rowToUi(draft, after, this.oauthByServer))
      this.allowConnect = allowOf(after)
    }
    this.publish()
    void this.refreshOauthStatus()
  }
}
function serversOf(snapshot: SettingsScopeSnapshot<McpSettings>): McpServerDraft[] {
  const raw = snapshot.value?.servers
  return Array.isArray(raw) ? raw.map(normalizeStoredRow) : []
}

function allowOf(snapshot: SettingsScopeSnapshot<McpSettings>): boolean {
  return snapshot.value?.allowConnect === true
}

function noteOf(snapshot: SettingsScopeSnapshot<McpSettings>): string {
  const note = snapshot.value?.note
  return typeof note === 'string' ? note : ''
}

function connectedMap(snapshot: SettingsScopeSnapshot<McpSettings>): Map<string, McpConnectedEntry> {
  const map = new Map<string, McpConnectedEntry>()
  const raw = snapshot.value?.connected
  if (!Array.isArray(raw)) return map
  for (const entry of raw) {
    if (isConnectedEntry(entry)) map.set(entry.serverName, entry)
  }
  return map
}

function failureMap(snapshot: SettingsScopeSnapshot<McpSettings>): Map<string, string> {
  const map = new Map<string, string>()
  const raw = snapshot.value?.connectFailures
  if (!Array.isArray(raw)) return map
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const name = (entry as { serverName?: unknown }).serverName
    const message = (entry as { message?: unknown }).message
    if (typeof name === 'string' && name && typeof message === 'string') {
      map.set(name, message)
    }
  }
  return map
}

function parkedSet(snapshot: SettingsScopeSnapshot<McpSettings>): Set<string> {
  const raw = snapshot.value?.parked
  return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
}

function resolveRowStatus(
  serverName: string,
  snapshot: SettingsScopeSnapshot<McpSettings>,
): { status: McpRowStatus; toolCount: number; failureMessage?: string } {
  const live = connectedMap(snapshot).get(serverName)
  if (live) {
    return {
      status: live.status ?? 'connected',
      toolCount: live.toolCount,
    }
  }
  const failure = failureMap(snapshot).get(serverName)
  if (failure !== undefined) {
    return { status: 'failed', toolCount: 0, failureMessage: failure }
  }
  if (!allowOf(snapshot) || parkedSet(snapshot).has(serverName)) {
    return { status: 'parked', toolCount: 0 }
  }
  return { status: 'idle', toolCount: 0 }
}

function enrichRowOauth(
  row: McpServerRow,
  oauthByServer: Map<string, McpOauthRowState>,
  oauthBusy: Set<string>,
): McpServerRow {
  if (row.transport !== 'http') return { ...row, oauth: undefined }
  const oauth = oauthByServer.get(row.serverName)
  const busy = oauthBusy.has(row.serverName)
  if (!oauth && !busy) return { ...row, oauth: { phase: 'unknown', loggedIn: false } }
  return {
    ...row,
    oauth: {
      ...(oauth ?? { phase: 'idle' as const, loggedIn: false }),
      ...(busy ? { busy: true } : {}),
    },
  }
}

function enrichRowStatus(
  row: McpServerRow,
  snapshot: SettingsScopeSnapshot<McpSettings>,
  oauthByServer: Map<string, McpOauthRowState>,
): McpServerRow {
  const resolved = resolveRowStatus(row.serverName, snapshot)
  const withStatus = { ...row, ...resolved }
  return enrichRowOauth(withStatus, oauthByServer, new Set())
}

function isConnectedEntry(value: unknown): value is McpConnectedEntry {
  if (!value || typeof value !== 'object') return false
  const row = value as McpConnectedEntry
  return typeof row.id === 'string'
    && typeof row.serverName === 'string'
    && typeof row.kind === 'string'
    && typeof row.toolCount === 'number'
}

function normalizeStoredRow(raw: McpServerDraft): McpServerDraft {
  const serverName = typeof raw.serverName === 'string' ? raw.serverName.trim() : ''
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  const command = typeof raw.command === 'string' ? raw.command.trim() : ''
  const cwd = typeof raw.cwd === 'string' ? raw.cwd.trim() : ''
  const args = Array.isArray(raw.args)
    ? raw.args.filter((part): part is string => typeof part === 'string')
    : undefined
  return {
    serverName,
    ...(url ? { url } : {}),
    ...(command ? { command } : {}),
    ...(args && args.length > 0 ? { args } : {}),
    ...(cwd ? { cwd } : {}),
    ...(raw.cwdAllowWorkspace === true ? { cwdAllowWorkspace: true } : {}),
  }
}

function rowToUi(
  draft: McpServerDraft,
  snapshot: SettingsScopeSnapshot<McpSettings>,
  oauthByServer: Map<string, McpOauthRowState>,
): McpServerRow {
  const transport: McpTransport = draft.url ? 'http' : 'stdio'
  const resolved = resolveRowStatus(draft.serverName, snapshot)
  const base: McpServerRow = {
    serverName: draft.serverName,
    transport,
    command: draft.command ?? '',
    url: draft.url ?? '',
    args: (draft.args ?? []).join(', '),
    cwd: draft.cwd ?? '',
    cwdAllowWorkspace: draft.cwdAllowWorkspace === true,
    ...resolved,
  }
  return enrichRowOauth(base, oauthByServer, new Set())
}

function rowFromUi(row: McpServerRow): McpServerDraft {
  const serverName = row.serverName.trim()
  if (row.transport === 'http') {
    return { serverName, url: row.url.trim() }
  }
  const args = row.args
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
  const cwd = row.cwd.trim()
  return {
    serverName,
    command: row.command.trim(),
    ...(args.length > 0 ? { args } : {}),
    ...(cwd ? { cwd } : {}),
    ...(cwd && row.cwdAllowWorkspace ? { cwdAllowWorkspace: true } : {}),
  }
}

function validateRow(row: McpServerRow): string | undefined {
  if (!row.serverName.trim()) return 'name'
  if (row.transport === 'http') return row.url.trim() ? undefined : 'url'
  return row.command.trim() ? undefined : 'command'
}

function mergeRowsByName(
  existing: readonly McpServerRow[],
  imported: readonly McpServerRow[],
): McpServerRow[] {
  const byName = new Map(existing.map(row => [row.serverName, row]))
  for (const row of imported) byName.set(row.serverName, row)
  return [...byName.values()]
}

/** Parse Cursor/Trae `{ mcpServers: { name: { command|url, args? } } }` into rows. */
export function rowsFromMcpPaste(raw: string): McpServerRow[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const root = parsed as { mcpServers?: unknown; servers?: unknown }
  const block = root.mcpServers ?? root.servers
  if (!block || typeof block !== 'object' || Array.isArray(block)) return []
  const rows: McpServerRow[] = []
  for (const [name, value] of Object.entries(block as Record<string, unknown>)) {
    const serverName = name.trim()
    if (!serverName || !value || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = value as Record<string, unknown>
    const url = typeof entry.url === 'string' ? entry.url.trim() : ''
    const command = typeof entry.command === 'string' ? entry.command.trim() : ''
    const cwd = typeof entry.cwd === 'string' ? entry.cwd.trim() : ''
    const cwdAllowWorkspace = entry.cwdAllowWorkspace === true
    const argsList = Array.isArray(entry.args)
      ? entry.args.filter((part): part is string => typeof part === 'string')
      : []
    if (url) {
      rows.push({
        serverName,
        transport: 'http',
        command: '',
        url,
        args: '',
        cwd: '',
        cwdAllowWorkspace: false,
        status: 'idle',
        toolCount: 0,
      })
      continue
    }
    if (!command) continue
    rows.push({
      serverName,
      transport: 'stdio',
      command,
      url: '',
      args: argsList.join(', '),
      cwd,
      cwdAllowWorkspace: Boolean(cwd) && cwdAllowWorkspace,
      status: 'idle',
      toolCount: 0,
    })
  }
  return rows
}
