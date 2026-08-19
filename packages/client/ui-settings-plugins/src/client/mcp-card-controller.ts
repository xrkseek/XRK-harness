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
  /** Comma-separated args shown in one control. */
  readonly args: string
  readonly cwd: string
}

/** What the MCP card renders. */
export interface McpCardState extends CardShell {
  /** Desired server rows staged for save. */
  readonly rows: readonly McpServerRow[]
  /** Live overlay from the running Host; read-only. */
  readonly connected: readonly McpConnectedEntry[]
  /** Face note (restart / allow policy); read-only. */
  readonly note: string
  /** Whether any row fails client-side validation. */
  readonly rowInvalid: boolean
}

/** The registration-side face the MCP card's slot entry injects. */
export interface McpCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useMcpCard. */
    mcpCard: SnapshotStore<McpCardState>
  }
  /** Stage one field on a row. */
  editRow: (index: number, patch: Partial<McpServerRow>) => void
  /** Append an empty stdio row. */
  addRow: () => void
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
      this.publish()
    }
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
      addRow: () => { this.addRow() },
      removeRow: (index) => { this.removeRow(index) },
      edit: () => { /* rows use editRow */ },
      resetField: () => { /* n/a for MCP list */ },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  private editRow(index: number, patch: Partial<McpServerRow>): void {
    const row = this.rows[index]
    if (row === undefined) return
    this.rows = this.rows.with(index, { ...row, ...patch })
    this.failed = false
    this.publish()
  }

  private addRow(): void {
    this.rows = [...this.rows, emptyRow()]
    this.failed = false
    this.publish()
  }

  private removeRow(index: number): void {
    if (index < 0 || index >= this.rows.length) return
    this.rows = this.rows.toSpliced(index, 1)
    this.failed = false
    this.publish()
  }

  private discard(): void {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready') return
    this.rows = serversOf(snapshot).map(rowToUi)
    this.failed = false
    this.publish()
  }

  private async save(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable || this.saving) return
    if (this.rows.some(row => validateRow(row) !== undefined)) return
    if (!this.dirty()) return
    this.saving = true
    this.failed = false
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
  const args = row.args.split(',').map(part => part.trim()).filter(part => part.length > 0)
  const cwd = row.cwd.trim()
  if (row.transport === 'http') {
    return {
      serverName,
      url: row.url.trim(),
      ...(args.length > 0 ? { args } : {}),
      ...(cwd ? { cwd } : {}),
    }
  }
  return {
    serverName,
    command: row.command.trim(),
    ...(args.length > 0 ? { args } : {}),
    ...(cwd ? { cwd } : {}),
  }
}

function emptyRow(): McpServerRow {
  return { serverName: '', transport: 'stdio', command: '', url: '', args: '', cwd: '' }
}

function validateRow(row: McpServerRow): string | undefined {
  if (!row.serverName.trim()) return 'serverName'
  if (row.transport === 'http') {
    return row.url.trim() ? undefined : 'url'
  }
  return row.command.trim() ? undefined : 'command'
}
