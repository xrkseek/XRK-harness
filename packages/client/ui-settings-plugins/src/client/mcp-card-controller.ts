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
  /** Comma-separated args (UI edits them as one launch line). */
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
  /** Show field errors only after a blocked save (so empty new rows stay calm). */
  readonly showErrors: boolean
}

/** The registration-side face the MCP card's slot entry injects. */
export interface McpCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useMcpCard. */
    mcpCard: SnapshotStore<McpCardState>
  }
  /** Stage one field on a row. */
  editRow: (index: number, patch: Partial<McpServerRow>) => void
  /** Fill empty name from command / URL when the user leaves the field. */
  suggestName: (index: number) => void
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
      suggestName: (index) => { this.suggestName(index) },
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

  private suggestName(index: number): void {
    const row = this.rows[index]
    if (row === undefined || row.serverName.trim()) return
    const suggested = suggestServerName(row)
    if (!suggested) return
    this.editRow(index, { serverName: suggested })
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
  const launch = splitLaunch(joinLaunch(row.command, row.args))
  const cwd = row.cwd.trim()
  return {
    serverName,
    command: launch.command,
    ...(launch.args.length > 0 ? { args: launch.args } : {}),
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
  return joinLaunch(row.command, row.args).trim() ? undefined : 'command'
}

/** Join command + CSV args into one launch line for the editor. */
export function joinLaunch(command: string, argsCsv: string): string {
  const args = argsCsv.split(',').map(part => part.trim()).filter(part => part.length > 0)
  return [command.trim(), ...args].filter(part => part.length > 0).join(' ')
}

/** Split a launch line into executable + args (quote-aware). */
export function splitLaunch(line: string): { command: string; args: string[] } {
  const tokens: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (const c of line.trim()) {
    if (quote) {
      if (c === quote) quote = null
      else cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (/\s/.test(c)) {
      if (cur) {
        tokens.push(cur)
        cur = ''
      }
      continue
    }
    cur += c
  }
  if (cur) tokens.push(cur)
  return { command: tokens[0] ?? '', args: tokens.slice(1) }
}

/** Apply a launch line edit onto command + args fields. */
export function applyLaunch(line: string): Pick<McpServerRow, 'command' | 'args'> {
  const { command, args } = splitLaunch(line)
  return { command, args: args.join(', ') }
}

/** Suggest a stable id from URL host or command basename. */
export function suggestServerName(row: McpServerRow): string {
  if (row.transport === 'http') {
    const raw = row.url.trim()
    if (!raw) return ''
    try {
      const host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
      const base = host.replace(/^www\./, '').split('.')[0] ?? ''
      return sanitizeName(base)
    } catch {
      return ''
    }
  }
  const launch = splitLaunch(joinLaunch(row.command, row.args))
  for (const token of [...launch.args].reverse()) {
    if (token.startsWith('@') || token.includes('/')) {
      const leaf = token.split('/').pop() ?? token
      const cleaned = sanitizeName(leaf.replace(/^@/, ''))
      if (cleaned && cleaned !== 'y') return cleaned
    }
  }
  const cmd = launch.command
  if (!cmd) return ''
  if (/^(npx|pnpm|yarn|bun|node|deno)$/i.test(cmd)) return ''
  const base = cmd.split(/[/\\]/).pop() ?? cmd
  return sanitizeName(base.replace(/\.(exe|cmd|bat|js|mjs|cjs)$/i, ''))
}

function sanitizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}
