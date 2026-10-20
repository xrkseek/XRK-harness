/**
 * Browser-side thin JSON card + store-method pack ZIP.
 * Full legal checks mirror Face (`xrk-agent-member` / `.xrk-agent-pack`).
 * Deflated third-party zips still need Face `team.importPack` / AI `team_import`.
 */

export const MEMBER_CARD_KIND = 'xrk-agent-member'
export const MEMBER_PACK_KIND = 'xrk-agent-pack'
export const MEMBER_PACK_MARKER = '.xrk-agent-pack'
export const MEMBER_PLAYBOOK_MAX = 20_000

export type SpawnRole = 'default' | 'worker' | 'researcher' | 'reviewer' | 'lead'

const ROLES: readonly SpawnRole[] = ['default', 'worker', 'researcher', 'reviewer', 'lead']

export interface MemberImportCard {
  readonly name: string
  readonly playbook: string
  readonly role: SpawnRole
  readonly brief?: string
  readonly inject?: 'minimal' | 'subagent'
  readonly tools?: { mode: 'allow' | 'deny'; names: readonly string[] }
}

function zipEntryName(name: string): string {
  return name
    .replaceAll('\\', '/')
    .split('/')
    .filter((part) => part.length > 0 && part !== '.' && part !== '..')
    .join('/') || 'unnamed'
}

function crc32(data: Uint8Array): number {
  let c = ~0 >>> 0
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
  }
  return ~c >>> 0
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setUint16(0, n & 0xffff, true)
  return b
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n >>> 0, true)
  return b
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let len = 0
  for (const p of parts) len += p.length
  const out = new Uint8Array(len)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function dosNow(): { time: number; date: number } {
  const d = new Date()
  const time =
    ((d.getHours() & 31) << 11) |
    ((d.getMinutes() & 63) << 5) |
    (Math.floor(d.getSeconds() / 2) & 31)
  const date =
    (((d.getFullYear() - 1980) & 127) << 9) |
    (((d.getMonth() + 1) & 15) << 5) |
    (d.getDate() & 31)
  return { time, date }
}

function buildStoredZip(entries: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const { time, date } = dosNow()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  const enc = new TextEncoder()

  for (const entry of entries) {
    const name = enc.encode(zipEntryName(entry.name))
    const data = entry.data
    const crc = crc32(data)
    const flags = 1 << 11
    const local = concatBytes([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      u16(20),
      u16(flags),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ])
    const central = concatBytes([
      new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
      u16(20),
      u16(20),
      u16(flags),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ])
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }

  const centralDir = concatBytes(centrals)
  const eocd = concatBytes([
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ])
  return concatBytes([...locals, centralDir, eocd])
}

/** Store-method ZIP only (product export). */
function readStoreZip(buf: Uint8Array): Map<string, Uint8Array> | undefined {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let eocd = -1
  const min = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return undefined
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const out = new Map<string, Uint8Array>()
  const dec = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || view.getUint32(p, true) !== 0x02014b50) return undefined
    const method = view.getUint16(p + 10, true)
    const compSize = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const localOff = view.getUint32(p + 42, true)
    const rawName = dec.decode(buf.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (rawName.endsWith('/')) continue
    if (method !== 0) return undefined
    if (localOff + 30 > buf.length || view.getUint32(localOff, true) !== 0x04034b50) {
      return undefined
    }
    const localNameLen = view.getUint16(localOff + 26, true)
    const localExtra = view.getUint16(localOff + 28, true)
    const dataOff = localOff + 30 + localNameLen + localExtra
    if (dataOff + compSize > buf.length) return undefined
    out.set(zipEntryName(rawName), buf.subarray(dataOff, dataOff + compSize))
  }
  return out
}

function parseTools(toolsRaw: unknown): MemberImportCard['tools'] | undefined {
  if (!toolsRaw || typeof toolsRaw !== 'object' || Array.isArray(toolsRaw)) return undefined
  const mode = (toolsRaw as { mode?: unknown }).mode
  const names = (toolsRaw as { names?: unknown }).names
  if ((mode === 'allow' || mode === 'deny') && Array.isArray(names)) {
    const list = names.map((n) => String(n).trim().toLowerCase()).filter(Boolean)
    if (list.length > 0) return { mode, names: list }
  }
  return undefined
}

function cardFromFields(
  row: Record<string, unknown>,
  playbookOverride?: string,
): MemberImportCard | null {
  const kind = typeof row.kind === 'string' ? row.kind.trim() : ''
  if (kind !== MEMBER_CARD_KIND && kind !== MEMBER_PACK_KIND) return null
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  const playbook = (playbookOverride ?? (typeof row.playbook === 'string' ? row.playbook : '')).trim()
  if (!name || !playbook) return null
  if (playbook.length > MEMBER_PLAYBOOK_MAX) return null
  const roleRaw = typeof row.role === 'string' ? row.role : 'worker'
  const role = (ROLES.includes(roleRaw as SpawnRole) ? roleRaw : 'worker') as SpawnRole
  const brief = typeof row.brief === 'string' ? row.brief.trim() : ''
  const inject = row.inject === 'subagent' || row.inject === 'minimal' ? row.inject : undefined
  const tools = parseTools(row.tools)
  return {
    name,
    playbook,
    role,
    ...(brief ? { brief } : {}),
    ...(inject ? { inject } : {}),
    ...(tools ? { tools } : {}),
  }
}

/** Parse thin JSON card text — requires `kind: xrk-agent-member`. */
export function parseMemberCardJson(raw: string): MemberImportCard | null {
  try {
    const row = JSON.parse(raw) as Record<string, unknown>
    const kind = typeof row.kind === 'string' ? row.kind.trim() : ''
    if (kind !== MEMBER_CARD_KIND) return null
    return cardFromFields(row)
  } catch {
    return null
  }
}

function parsePackMap(files: Map<string, Uint8Array>): MemberImportCard | null {
  const dec = new TextDecoder()
  const markerBuf = files.get(MEMBER_PACK_MARKER)
  if (!markerBuf) return null
  const markerText = dec.decode(markerBuf).trim()
  let markerOk = markerText.includes(MEMBER_PACK_KIND)
  if (!markerOk) {
    try {
      const row = JSON.parse(markerText) as { kind?: unknown }
      markerOk = row.kind === MEMBER_PACK_KIND
    } catch {
      markerOk = false
    }
  }
  if (!markerOk) return null
  const playbookBuf = files.get('playbook.md') ?? files.get('PLAYBOOK.md')
  if (!playbookBuf) return null
  const playbook = dec.decode(playbookBuf).trim()
  if (!playbook || playbook.length > MEMBER_PLAYBOOK_MAX) return null
  const manifestBuf =
    files.get('manifest.json') ?? files.get('member.json') ?? files.get('card.json')
  if (!manifestBuf) return null
  try {
    const row = JSON.parse(dec.decode(manifestBuf)) as Record<string, unknown>
    const kind = typeof row.kind === 'string' ? row.kind.trim() : ''
    if (kind !== MEMBER_PACK_KIND && kind !== MEMBER_CARD_KIND) return null
    return cardFromFields({ ...row, kind: MEMBER_CARD_KIND }, playbook)
  } catch {
    return null
  }
}

export function memberExportCardJson(card: MemberImportCard): string {
  return JSON.stringify({
    kind: MEMBER_CARD_KIND,
    name: card.name,
    playbook: card.playbook,
    role: card.role,
    ...(card.brief ? { brief: card.brief } : {}),
    ...(card.inject ? { inject: card.inject } : {}),
    ...(card.tools ? { tools: card.tools } : {}),
  }, null, 2)
}

export function buildMemberPackZip(card: MemberImportCard): Uint8Array {
  const enc = new TextEncoder()
  const manifest = {
    kind: MEMBER_PACK_KIND,
    version: 1,
    name: card.name,
    role: card.role,
    ...(card.brief ? { brief: card.brief } : {}),
    ...(card.inject ? { inject: card.inject } : {}),
    ...(card.tools ? { tools: card.tools } : {}),
  }
  const playbook = card.playbook.endsWith('\n') ? card.playbook : `${card.playbook}\n`
  const marker = `${JSON.stringify({ kind: MEMBER_PACK_KIND, version: 1 })}\n`
  return buildStoredZip([
    { name: MEMBER_PACK_MARKER, data: enc.encode(marker) },
    { name: 'manifest.json', data: enc.encode(`${JSON.stringify(manifest, null, 2)}\n`) },
    { name: 'playbook.md', data: enc.encode(playbook) },
  ])
}

export type MemberImportResult =
  | { readonly ok: true; readonly card: MemberImportCard; readonly source: 'json' | 'pack' }
  | { readonly ok: false; readonly reason: 'bad' | 'deflate' | 'kind' }

/** Import from JSON text or product store-method pack ZIP bytes. */
export function parseMemberImportBytes(
  bytes: Uint8Array,
  fileName?: string,
): MemberImportResult {
  const lower = (fileName ?? '').toLowerCase()
  const looksZip =
    lower.endsWith('.zip') ||
    (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b)

  if (looksZip) {
    const files = readStoreZip(bytes)
    if (!files) return { ok: false, reason: 'deflate' }
    const card = parsePackMap(files)
    if (!card) return { ok: false, reason: 'bad' }
    return { ok: true, card, source: 'pack' }
  }

  const text = new TextDecoder().decode(bytes)
  try {
    const row = JSON.parse(text) as Record<string, unknown>
    const kind = typeof row.kind === 'string' ? row.kind.trim() : ''
    if (kind && kind !== MEMBER_CARD_KIND) return { ok: false, reason: 'kind' }
  } catch {
    return { ok: false, reason: 'bad' }
  }
  const card = parseMemberCardJson(text)
  if (!card) return { ok: false, reason: 'bad' }
  return { ok: true, card, source: 'json' }
}

export function safeMemberFileStem(name: string): string {
  const stem = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').replace(/\s+/g, '-').slice(0, 48)
  return stem || 'member'
}

/** Browser helper: Uint8Array → base64 for Face `team.importPack`. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Browser helper: base64 → Uint8Array for Face `team.export` zip. */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => { URL.revokeObjectURL(url) }, 1500)
}

/** Thin member → JSON download (no Face round-trip). */
export function downloadMemberCardJson(card: MemberImportCard): void {
  const text = memberExportCardJson(card)
  triggerDownload(
    new Blob([text], { type: 'application/json' }),
    `xrk-member-${safeMemberFileStem(card.name)}.json`,
  )
}

/** Download zip/json from Face export payload. */
export function downloadExportedMember(payload: {
  readonly format: 'json' | 'zip'
  readonly fileName: string
  readonly text?: string
  readonly base64?: string
}): void {
  if (payload.format === 'json' && payload.text) {
    triggerDownload(
      new Blob([payload.text], { type: 'application/json' }),
      payload.fileName,
    )
    return
  }
  if (payload.format === 'zip' && payload.base64) {
    const bytes = base64ToBytes(payload.base64)
    triggerDownload(
      new Blob([bytes], { type: 'application/zip' }),
      payload.fileName,
    )
    return
  }
  throw new Error('export payload incomplete')
}
