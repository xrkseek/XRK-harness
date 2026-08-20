/** The MCP card's staged form over the `mcp` settings namespace. */

import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@xrkseek/client-runtime/client'
import { createSnapshotStore } from '@xrkseek/client-runtime/client'
import type { CardActions, CardShell } from './card-form.ts'

/** Namespace of the MCP desired-servers draft. */
export const MCP_NS = 'mcp'

/** One live MCP plugin the Host reports in the connected overlay. */
export interface McpConnectedEntry {
  readonly id: string
  readonly serverName: string
  readonly kind: string
  readonly toolCount: number
  /** Supervisor health; omitted on older Hosts. */
  readonly status?: 'connected' | 'reconnecting' | 'gave-up'
}

/** Host-served MCP namespace value (desired + overlay). */
export interface McpSettings {
  readonly servers?: readonly McpServerDraft[]
  readonly connected?: readonly McpConnectedEntry[]
  readonly note?: string
}

/** One desired server row persisted to host-settings.json. */
export interface McpServerDraft {
  readonly serverName: string
  readonly command?: string
  readonly url?: string
  readonly args?: readonly string[]
  readonly cwd?: string
}

/** Transport kind the card edits for one row. */
export type McpTransport = 'stdio' | 'http'

/** One editable row in the card UI. */
export interface McpServerRow {
  readonly serverName: string
  readonly transport: McpTransport
  readonly command: string
  readonly url: string
  /** Comma-separated args in the editor. */
  readonly args: string
  readonly cwd: string
}

/** What the MCP card renders. */
export interface McpCardState extends CardShell {
  /** Desired server rows staged for save. */
  readonly rows: readonly McpServerRow[]
  /** Live overlay from the running Host; read-only. */
  readonly connected: readonly McpConnectedEntry[]
  /** Face note (live remount / restart / allow policy); read-only. */
  readonly note: string
  /** Whether any row fails client-side validation. */
  readonly rowInvalid: boolean
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
}

/** Bridges the `mcp` scope onto the card's staged server list. */
export class McpCardController {
  private readonly store: SnapshotStore<McpCardState>
  private rows: McpServerRow[] = []
  private seeded = false
  private saving = false
  private failed = false
  private showErrors = false

  /** @param scope - the bound settings scope for the `mcp` namespace. */
  constructor(private readonly scope: SettingsScope<McpSettings>) {
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
    if (!this.seeded || (force && !this.dirty())) {
      this.rows = serversOf(snapshot).map(rowToUi)
      this.seeded = true
      this.failed = false
      this.showErrors = false
    }
    // Always republish: connected/note/status overlay can change while rows stay dirty.
    this.publish()
  }

  private projection(): McpCardState {
    const snapshot = this.scope.getSnapshot()
    const invalid = this.rows.some(row => validateRow(row) !== undefined)
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.dirty(),
      invalid,
      rowInvalid: invalid,
      showErrors: this.showErrors && invalid,
      saving: this.saving,
      failed: this.failed,
      rows: this.rows,
      connected: connectedOf(snapshot),
      note: noteOf(snapshot),
    }
  }

  private dirty(): boolean {
    if (!this.seeded) return false
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready') return false
    return JSON.stringify(this.rows.map(rowFromUi)) !== JSON.stringify(serversOf(snapshot))
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
      edit: () => { /* rows use paste merge */ },
      resetField: () => { /* n/a for MCP list */ },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  private editRow(index: number, patch: Partial<McpServerRow>): void {
    const row = this.rows[index]
    if (row === undefined) return
    let next: McpServerRow = { ...row, ...patch }
    if (patch.transport !== undefined && patch.transport !== row.transport) {
      next = patch.transport === 'http'
        ? { ...next, command: '', args: '', cwd: '' }
        : { ...next, url: '' }
    }
    this.rows = this.rows.with(index, next)
    this.failed = false
    if (!this.rows.some(r => validateRow(r) !== undefined)) this.showErrors = false
    this.publish()
  }

  private addRow(paste?: string): McpPasteResult {
    const raw = typeof paste === 'string' ? paste.trim() : ''
    if (!raw) return 'empty'
    const imported = rowsFromMcpPaste(raw)
    if (imported.length === 0) return 'invalid'
    this.rows = mergeRowsByName(this.rows, imported)
    this.failed = false
    this.publish()
    return 'ok'
  }

  private removeRow(index: number): void {
    if (index < 0 || index >= this.rows.length) return
    this.rows = this.rows.toSpliced(index, 1)
    this.failed = false
    if (!this.rows.some(r => validateRow(r) !== undefined)) this.showErrors = false
    this.publish()
  }

  private discard(): void {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready') return
    this.rows = serversOf(snapshot).map(rowToUi)
    this.failed = false
    this.showErrors = false
    this.publish()
  }

  private async save(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable || this.saving) return
    if (this.rows.some(row => validateRow(row) !== undefined)) {
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
    await this.scope.set('servers', payload)
    const after = this.scope.getSnapshot()
    const landed = after.status === 'ready'
      && JSON.stringify(serversOf(after)) === JSON.stringify(payload)
    this.saving = false
    this.failed = !landed
    if (landed) this.seeded = true
    this.publish()
  }
}

function serversOf(snapshot: SettingsScopeSnapshot<McpSettings>): McpServerDraft[] {
  const raw = snapshot.value?.servers
  return Array.isArray(raw) ? raw.map(normalizeStoredRow) : []
}

function connectedOf(snapshot: SettingsScopeSnapshot<McpSettings>): McpConnectedEntry[] {
  const raw = snapshot.value?.connected
  if (!Array.isArray(raw)) return []
  return raw.filter(isConnectedEntry)
}

function noteOf(snapshot: SettingsScopeSnapshot<McpSettings>): string {
  return typeof snapshot.value?.note === 'string' ? snapshot.value.note : ''
}

function isConnectedEntry(value: unknown): value is McpConnectedEntry {
  return value !== null
    && typeof value === 'object'
    && typeof (value as McpConnectedEntry).serverName === 'string'
}

function normalizeStoredRow(row: McpServerDraft): McpServerDraft {
  const url = typeof row.url === 'string' ? row.url.trim() : ''
  const command = typeof row.command === 'string' ? row.command.trim() : ''
  return {
    serverName: String(row.serverName ?? '').trim(),
    ...(url ? { url } : command ? { command } : {}),
    ...(Array.isArray(row.args) && row.args.length > 0 ? { args: row.args.map(String) } : {}),
    ...(typeof row.cwd === 'string' && row.cwd.trim() ? { cwd: row.cwd.trim() } : {}),
  }
}

function rowToUi(row: McpServerDraft): McpServerRow {
  const url = typeof row.url === 'string' ? row.url : ''
  return {
    serverName: row.serverName,
    transport: url ? 'http' : 'stdio',
    command: typeof row.command === 'string' ? row.command : '',
    url,
    args: Array.isArray(row.args) ? row.args.join(', ') : '',
    cwd: typeof row.cwd === 'string' ? row.cwd : '',
  }
}

function rowFromUi(row: McpServerRow): McpServerDraft {
  const serverName = row.serverName.trim()
  if (row.transport === 'http') {
    return {
      serverName,
      url: row.url.trim(),
    }
  }
  const args = row.args.split(',').map(part => part.trim()).filter(part => part.length > 0)
  const cwd = row.cwd.trim()
  return {
    serverName,
    command: row.command.trim(),
    ...(args.length > 0 ? { args } : {}),
    ...(cwd ? { cwd } : {}),
  }
}

/** Upsert imported rows by `serverName` (later paste wins). */
function mergeRowsByName(
  existing: readonly McpServerRow[],
  imported: readonly McpServerRow[],
): McpServerRow[] {
  const byName = new Map(existing.map(row => [row.serverName, row] as const))
  for (const row of imported) {
    byName.set(row.serverName, row)
  }
  const order: string[] = []
  for (const row of existing) {
    if (!order.includes(row.serverName)) order.push(row.serverName)
  }
  for (const row of imported) {
    if (!order.includes(row.serverName)) order.push(row.serverName)
  }
  return order.map(name => byName.get(name)!).filter(Boolean)
}

function namedRowToUi(name: string, row: Record<string, unknown>): McpServerRow | undefined {
  const serverName = name.trim()
  if (!serverName) return undefined
  const url = typeof row.url === 'string' ? row.url.trim() : ''
  const command = typeof row.command === 'string' ? row.command.trim() : ''
  if (!url && !command) return undefined
  return {
    serverName,
    transport: url ? 'http' : 'stdio',
    command,
    url,
    args: Array.isArray(row.args) ? row.args.map(String).join(', ') : '',
    cwd: typeof row.cwd === 'string' ? row.cwd : '',
  }
}

/**
 * Cursor / Trae / Claude Desktop paste: `{ "mcpServers": { "name": { "command", "args" } } }`.
 * Also accepts a bare name map or a Face array of `{ serverName, command }`.
 */
export function rowsFromMcpPaste(raw: string): McpServerRow[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (Array.isArray(parsed)) {
    const out: McpServerRow[] = []
    for (const row of parsed) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue
      const o = row as Record<string, unknown>
      const mapped = namedRowToUi(String(o.serverName ?? ''), o)
      if (mapped) out.push(mapped)
    }
    return out
  }
  if (!parsed || typeof parsed !== 'object') return []
  const root = parsed as Record<string, unknown>
  const map = (
    root.mcpServers && typeof root.mcpServers === 'object' && !Array.isArray(root.mcpServers)
      ? root.mcpServers
      : root
  ) as Record<string, unknown>
  const out: McpServerRow[] = []
  for (const [name, row] of Object.entries(map)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const mapped = namedRowToUi(name, row as Record<string, unknown>)
    if (mapped) out.push(mapped)
  }
  return out
}

function validateRow(row: McpServerRow): string | undefined {
  if (!row.serverName.trim()) return 'serverName'
  if (row.transport === 'http') {
    return row.url.trim() ? undefined : 'url'
  }
  return row.command.trim() ? undefined : 'command'
}
