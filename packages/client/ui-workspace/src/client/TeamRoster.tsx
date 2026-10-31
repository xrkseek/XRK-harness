/**
 * Sidebar Agent Team: 干员 balls (shape / color / face).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconFolderCloseRegular, Modal,
} from '@xrkseek/client-ui-primitives'
import {
  patchTeamRosterLive,
  type SessionId,
  type WorkspaceId,
} from '@xrkseek/client-runtime/client'
import type {
  AgentTeamMemberRow, DirectoryFlowOwnerProps, WorkspaceBrowserProps,
} from './contract/slots.ts'
import type { WorkspaceKey } from './locales.ts'
import { WorkspacePickFlow } from './WorkspacePicker.tsx'
import {
  CompanionBall,
  CompanionKitMark,
  CompanionShapeGlyph,
  COMPANION_COLORS,
  COMPANION_SHAPES,
  companionPaint,
} from './CompanionBall.tsx'
import {
  addDressingSticker,
  BOSS_NICKNAME_MAX,
  removeDressingSticker,
  setBossLookField,
  setBossNickname,
  useBossLook,
  useBossNickname,
  useDressingStickers,
  usePresenceModuleEnabled,
  useSeatTitles,
} from './dressing-scope.ts'
import {
  FACE_MAX,
  GLASSES_BUILTINS,
  HAT_BUILTINS,
  HELD_BUILTINS,
  resolveEnginePick,
  resolveStickerOverlay,
  splitLegacyKit,
  stickerIdFromPick,
  stickerRef,
  stickersForSlot,
  type DressingSticker,
} from './dressing-library.ts'
import css from './TeamRoster.module.css'
import {
  bytesToBase64,
  downloadExportedMember,
  downloadMemberCardJson,
  parseMemberImportBytes,
  type SpawnRole,
} from './member-pack.ts'
import { catalogMemberBrief, catalogMemberName } from './catalog-labels.ts'

type Translate = WorkspaceBrowserProps['t']
type ToolMode = 'inherit' | 'allow' | 'deny'

const ROLES: readonly SpawnRole[] = ['default', 'worker', 'researcher', 'reviewer', 'lead']
const FILE_TOOLS = 'bash,read,grep,glob'

function appearanceOf(member: AgentTeamMemberRow, stickers: readonly DressingSticker[]): {
  shape: string
  color: string
  kitHat: string
  kitGlasses: string
  kitHeld: string
  engineHat: string
  engineGlasses: string
  engineHeld: string
  overlayHat?: string
  overlayGlasses?: string
  overlayHeld?: string
} {
  const split = splitLegacyKit(member.appearance?.kit)
  const kitHat = member.appearance?.kitHat ?? split.hat
  const kitGlasses = member.appearance?.kitGlasses ?? split.glasses
  const kitHeld = member.appearance?.kitHeld ?? 'none'
  const hatImg = resolveStickerOverlay(kitHat, stickers)
    || (stickerIdFromPick(kitHat) ? '' : (member.appearance?.overlayHat ?? member.appearance?.face ?? ''))
  const glassesImg = resolveStickerOverlay(kitGlasses, stickers)
    || (stickerIdFromPick(kitGlasses) ? '' : (member.appearance?.overlayGlasses ?? ''))
  const heldImg = resolveStickerOverlay(kitHeld, stickers)
    || (stickerIdFromPick(kitHeld) ? '' : (member.appearance?.overlayHeld ?? ''))
  return {
    shape: member.appearance?.shape ?? 'blob',
    color: member.appearance?.color ?? 'cream',
    kitHat,
    kitGlasses,
    kitHeld,
    engineHat: resolveEnginePick(kitHat, HAT_BUILTINS),
    engineGlasses: resolveEnginePick(kitGlasses, GLASSES_BUILTINS),
    engineHeld: resolveEnginePick(kitHeld, HELD_BUILTINS),
    ...(hatImg ? { overlayHat: hatImg } : {}),
    ...(glassesImg ? { overlayGlasses: glassesImg } : {}),
    ...(heldImg ? { overlayHeld: heldImg } : {}),
  }
}

function splitToolNames(raw: string): string[] {
  return raw.split(/[\s,]+/).map(n => n.trim().toLowerCase()).filter(Boolean)
}

function MemberGlyph({
  presenceOn,
  look,
}: {
  presenceOn: boolean
  look: ReturnType<typeof appearanceOf>
}) {
  if (!presenceOn) {
    return (
      <span
        className={css.listSwatch}
        style={{ background: companionPaint(look.color, false).body }}
        aria-hidden
      />
    )
  }
  return (
    <CompanionBall
      shape={look.shape}
      color={look.color}
      kitHat={look.engineHat}
      kitGlasses={look.engineGlasses}
      kitHeld={look.engineHeld}
      {...(look.overlayHat ? { overlayHat: look.overlayHat } : {})}
      {...(look.overlayGlasses ? { overlayGlasses: look.overlayGlasses } : {})}
      {...(look.overlayHeld ? { overlayHeld: look.overlayHeld } : {})}
    />
  )
}

function MemberBall({
  member,
  displayName,
  displayBrief,
  stickers,
  selected,
  disabled,
  seedLabel,
  advancedLabel,
  notReadyLabel,
  roleLabel,
  presenceOn,
  onSelect,
}: {
  member: AgentTeamMemberRow
  displayName: string
  displayBrief?: string
  stickers: readonly DressingSticker[]
  selected: boolean
  disabled: boolean
  seedLabel: string
  advancedLabel: string
  notReadyLabel: string
  roleLabel: string
  presenceOn: boolean
  onSelect: () => void
}) {
  const look = appearanceOf(member, stickers)
  const title = displayBrief ? `${displayName} — ${displayBrief}` : displayName
  if (!presenceOn) {
    const meta = [roleLabel, displayBrief?.trim()].filter(Boolean).join(' · ')
    return (
      <button
        type="button"
        className={selected ? css.listRowOn : css.listRow}
        disabled={disabled}
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={title}
        title={title}
      >
        <MemberGlyph presenceOn={false} look={look} />
        <span className={css.listBody}>
          <span className={css.listNameRow}>
            <span className={css.listName}>{displayName}</span>
            {member.kind === 'advanced'
              ? <span className={css.listTag}>{advancedLabel}</span>
              : null}
            {member.catalog === true || member.seed === true
              ? <span className={css.listTag}>{seedLabel}</span>
              : null}
            {member.ready === false
              ? <span className={css.listTagWarn}>{notReadyLabel}</span>
              : null}
          </span>
          {meta ? <span className={css.listMeta}>{meta}</span> : null}
        </span>
      </button>
    )
  }
  return (
    <button
      type="button"
      className={selected ? css.ballCardOn : css.ballCard}
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={title}
      title={title}
    >
      <span className={css.ballGlyphWrap}>
        <MemberGlyph presenceOn={presenceOn} look={look} />
        {member.kind === 'advanced'
          ? <span className={css.advancedMark} title={advancedLabel}>{advancedLabel}</span>
          : null}
      </span>
      <span className={css.ballCaption}>
        <span className={css.ballName}>{displayName}</span>
        {member.catalog === true || member.seed === true
          ? <span className={css.seed}>{seedLabel}</span>
          : null}
        {member.ready === false
          ? <span className={css.notReady}>{notReadyLabel}</span>
          : null}
      </span>
    </button>
  )
}

function isDraftMemberId(id: string | null): id is 'new-global' | 'new-workspace' {
  return id === 'new-global' || id === 'new-workspace'
}

function isBossSeatId(id: string | null): id is 'boss' {
  return id === 'boss'
}

/** Fixed 老板 seat ball — look comes from Host `ui-presence`, not roster. */
function BossSeatBall({
  selected,
  disabled,
  displayName,
  look,
  presenceOn,
  seedLabel,
  onSelect,
}: {
  selected: boolean
  disabled: boolean
  displayName: string
  look: {
    shape: string
    color: string
    engineHat: string
    engineGlasses: string
    engineHeld: string
    overlayHat?: string
    overlayGlasses?: string
    overlayHeld?: string
  }
  presenceOn: boolean
  seedLabel: string
  onSelect: () => void
}) {
  if (!presenceOn) {
    return (
      <button
        type="button"
        className={selected ? css.listRowOn : css.listRow}
        disabled={disabled}
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={displayName}
        title={displayName}
      >
        <MemberGlyph presenceOn={false} look={{
          shape: look.shape,
          color: look.color,
          kitHat: look.engineHat,
          kitGlasses: look.engineGlasses,
          kitHeld: look.engineHeld,
          engineHat: look.engineHat,
          engineGlasses: look.engineGlasses,
          engineHeld: look.engineHeld,
          ...(look.overlayHat ? { overlayHat: look.overlayHat } : {}),
          ...(look.overlayGlasses ? { overlayGlasses: look.overlayGlasses } : {}),
          ...(look.overlayHeld ? { overlayHeld: look.overlayHeld } : {}),
        }}
        />
        <span className={css.listBody}>
          <span className={css.listNameRow}>
            <span className={css.listName}>{displayName}</span>
            <span className={css.listTag}>{seedLabel}</span>
          </span>
        </span>
      </button>
    )
  }
  return (
    <button
      type="button"
      className={selected ? css.ballCardOn : css.ballCard}
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={displayName}
      title={displayName}
    >
      <span className={css.ballGlyphWrap}>
        <CompanionBall
          shape={look.shape}
          color={look.color}
          kitHat={look.engineHat}
          kitGlasses={look.engineGlasses}
          kitHeld={look.engineHeld}
          {...(look.overlayHat ? { overlayHat: look.overlayHat } : {})}
          {...(look.overlayGlasses ? { overlayGlasses: look.overlayGlasses } : {})}
          {...(look.overlayHeld ? { overlayHeld: look.overlayHeld } : {})}
        />
      </span>
      <span className={css.ballCaption}>
        <span className={css.ballName}>{displayName}</span>
        <span className={css.seed}>{seedLabel}</span>
      </span>
    </button>
  )
}

function NewMemberBall({
  selected,
  disabled,
  caption,
  label,
  presenceOn,
  onSelect,
}: {
  selected: boolean
  disabled: boolean
  caption: string
  label: string
  presenceOn: boolean
  onSelect: () => void
}) {
  if (!presenceOn) {
    return (
      <button
        type="button"
        className={selected ? css.listRowOn : css.listRow}
        disabled={disabled}
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={label}
      >
        <span className={`${css.listSwatch} ${css.listSwatchEmpty}`} aria-hidden>+</span>
        <span className={css.listBody}>
          <span className={css.listName}>{caption}</span>
        </span>
      </button>
    )
  }
  return (
    <button
      type="button"
      className={selected ? css.ballCardOn : css.ballCard}
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={label}
    >
      <CompanionBall shape="blob" color="cream" empty />
      <span className={css.ballName}>{caption}</span>
    </button>
  )
}

export function TeamRoster({
  open,
  onClose,
  sessionId,
  t,
  useWorkspaces,
  createWorkspace,
  useDirectoryFlow,
  renderDirectoryFlow,
  startSession,
  listTeam,
  upsertTeamMember,
  removeTeamMember,
  exportTeamMember,
  importTeamPack,
}: {
  open: boolean
  onClose: () => void
  sessionId: SessionId | undefined
  t: Translate
  useWorkspaces: WorkspaceBrowserProps['useWorkspaces']
  createWorkspace: WorkspaceBrowserProps['createWorkspace']
  useDirectoryFlow: WorkspaceBrowserProps['useDirectoryFlow']
  renderDirectoryFlow: (owner: DirectoryFlowOwnerProps) => ReactNode
  startSession: (workspaceId?: WorkspaceId) => void
  listTeam: NonNullable<WorkspaceBrowserProps['listTeam']>
  upsertTeamMember: NonNullable<WorkspaceBrowserProps['upsertTeamMember']>
  removeTeamMember?: WorkspaceBrowserProps['removeTeamMember']
  exportTeamMember?: WorkspaceBrowserProps['exportTeamMember']
  importTeamPack?: WorkspaceBrowserProps['importTeamPack']
}) {
  const stickers = useDressingStickers()
  const presenceOn = usePresenceModuleEnabled()
  const seatTitles = useSeatTitles()
  const bossLook = useBossLook()
  const bossNickname = useBossNickname()
  const [bossNickDraft, setBossNickDraft] = useState(bossNickname)
  const workspaces = useWorkspaces(state => state.items)
  const currentWorkspace = useMemo(
    () => sessionId === undefined
      ? undefined
      : workspaces.find(row => row.sessionIds.includes(sessionId)),
    [workspaces, sessionId],
  )
  const wsPickRef = useRef<HTMLDivElement>(null)
  const [wsPickOpen, setWsPickOpen] = useState(false)
  const [members, setMembers] = useState<readonly AgentTeamMemberRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<
    string | 'boss' | 'new-global' | 'new-workspace' | null
  >(null)
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState('')
  const [playbook, setPlaybook] = useState('')
  const [role, setRole] = useState<SpawnRole>('worker')
  const [shape, setShape] = useState<string>('blob')
  const [color, setColor] = useState<string>('cream')
  const [kitHat, setKitHat] = useState('none')
  const [kitGlasses, setKitGlasses] = useState('none')
  const [kitHeld, setKitHeld] = useState('none')
  const [scope, setScope] = useState<'global' | 'workspace'>('workspace')
  const [inject, setInject] = useState<'minimal' | 'subagent'>('minimal')
  const [brief, setBrief] = useState('')
  const [toolsMode, setToolsMode] = useState<ToolMode>('inherit')
  const [toolsNames, setToolsNames] = useState('')
  const [exportHint, setExportHint] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const bossSelected = isBossSeatId(selectedId)
  const selected = selectedId && !isDraftMemberId(selectedId) && !bossSelected
    ? members.find(row => row.id === selectedId)
    : undefined
  const managerMember = members.find(row => row.id === 'mem_seed_manager')
  const sunflowerMember = members.find(row => row.id === 'mem_seed_xrkseek')
  /** Built-in office seats: 老板 · 经理 · 向日葵 share one rail row. */
  const seatMembers = [managerMember, sunflowerMember].filter(
    (row): row is AgentTeamMemberRow => row != null,
  )

  useEffect(() => {
    if (!bossSelected) return
    setBossNickDraft((prev) => (prev === bossNickname ? prev : bossNickname))
  }, [bossSelected, bossNickname])
  const bossRailLook = useMemo(() => {
    const kitHat = bossLook.kitHat
    const kitGlasses = bossLook.kitGlasses
    const kitHeld = bossLook.kitHeld
    return {
      shape: bossLook.shape,
      color: bossLook.color,
      engineHat: resolveEnginePick(kitHat, HAT_BUILTINS),
      engineGlasses: resolveEnginePick(kitGlasses, GLASSES_BUILTINS),
      engineHeld: resolveEnginePick(kitHeld, HELD_BUILTINS),
      ...(resolveStickerOverlay(kitHat, stickers)
        ? { overlayHat: resolveStickerOverlay(kitHat, stickers)! }
        : {}),
      ...(resolveStickerOverlay(kitGlasses, stickers)
        ? { overlayGlasses: resolveStickerOverlay(kitGlasses, stickers)! }
        : {}),
      ...(resolveStickerOverlay(kitHeld, stickers)
        ? { overlayHeld: resolveStickerOverlay(kitHeld, stickers)! }
        : {}),
    }
  }, [bossLook, stickers])
  const seatIds = new Set(seatMembers.map(row => row.id))
  const globalMembers = members.filter(
    row => row.scope !== 'workspace' && !seatIds.has(row.id),
  )
  const workspaceMembers = members.filter(row => row.scope === 'workspace')
  const workspaceTitleById = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of workspaces) {
      if (row.kind === 'agent-home') continue
      map.set(row.workspaceId, row.title)
    }
    return map
  }, [workspaces])
  /** Group workspace-scoped 干员 by owning project; current canvas first. */
  const workspaceGroups = useMemo(() => {
    const byId = new Map<string, AgentTeamMemberRow[]>()
    for (const member of workspaceMembers) {
      const wid = member.workspaceId
        ?? (member.scope === 'workspace' ? currentWorkspace?.workspaceId : undefined)
      if (!wid) continue
      const bucket = byId.get(wid)
      if (bucket) bucket.push(member)
      else byId.set(wid, [member])
    }
    const currentId = currentWorkspace?.workspaceId
    if (currentId && !byId.has(currentId)) byId.set(currentId, [])
    const ids = [...byId.keys()]
    ids.sort((a, b) => {
      if (a === currentId) return -1
      if (b === currentId) return 1
      const ta = workspaceTitleById.get(a) ?? a
      const tb = workspaceTitleById.get(b) ?? b
      return ta.localeCompare(tb, 'zh')
    })
    return ids.map((id) => ({
      workspaceId: id,
      title: workspaceTitleById.get(id) ?? id,
      current: id === currentId,
      members: byId.get(id) ?? [],
    }))
  }, [workspaceMembers, currentWorkspace?.workspaceId, workspaceTitleById])
  const catalogSeed = selected?.catalog === true
    && selected.scope === 'global'
  const managerSelected = selected?.id === 'mem_seed_manager'
  const sunflowerSelected = selected?.id === 'mem_seed_xrkseek'
  /** Catalog playbook / name locked; 经理可改装扮；catalog 昵称除向日葵外可改。 */
  const fieldsLocked = Boolean(catalogSeed)
  const appearanceLocked = Boolean(catalogSeed) && !managerSelected
  const nicknameLocked = sunflowerSelected
  const canDelete = selected !== undefined
    && removeTeamMember !== undefined
    && !catalogSeed
  const canExport = selected !== undefined
    && !isDraftMemberId(selectedId)
    && !catalogSeed
  const reload = async () => {
    if (sessionId === undefined) return
    setMembers(await listTeam(sessionId))
  }

  const loadMember = (member: AgentTeamMemberRow | undefined) => {
    const look = member
      ? appearanceOf(member, stickers)
      : { shape: 'blob', color: 'cream', kitHat: 'none', kitGlasses: 'none', kitHeld: 'none' }
    // Catalog seeds keep Chinese Host names; the editor shows locale labels.
    setName(member ? catalogMemberName(member.id, member.name, t, seatTitles) : '')
    setNickname(member?.nickname ?? '')
    setPlaybook(member?.playbook ?? '')
    setRole((ROLES.includes(member?.role as SpawnRole) ? member?.role : 'worker') as SpawnRole)
    setShape(look.shape)
    setColor(look.color)
    setKitHat(look.kitHat)
    setKitGlasses(look.kitGlasses)
    setKitHeld(look.kitHeld)
    setScope(member?.scope === 'global' ? 'global' : 'workspace')
    setInject(member?.inject === 'subagent' ? 'subagent' : 'minimal')
    setBrief(member
      ? (catalogMemberBrief(member.id, member.brief, t, seatTitles) ?? '')
      : '')
    if (member?.tools?.names?.length) {
      setToolsMode(member.tools.mode === 'deny' ? 'deny' : 'allow')
      setToolsNames(member.tools.names.join(','))
    } else {
      setToolsMode('inherit')
      setToolsNames('')
    }
  }

  useEffect(() => {
    if (!open) return
    setError(null)
    setSelectedId(null)
    setWsPickOpen(false)
    if (sessionId === undefined) {
      setMembers([])
      return
    }
    void reload().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }, [open, sessionId])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const importMemberFromFile = (file: File) => {
    if (sessionId === undefined) return
    void file.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf)
      const parsed = parseMemberImportBytes(bytes, file.name)
      if (!parsed.ok) {
        setError(
          parsed.reason === 'deflate'
            ? t('team.importDeflate')
            : parsed.reason === 'kind'
              ? t('team.importKind')
              : t('team.importBad'),
        )
        return
      }
      const card = parsed.card
      if (parsed.source === 'pack') {
        const importPack = importTeamPack
        if (importPack === undefined) {
          setError(t('team.importPackNeedHost'))
          return
        }
        // Destination = left-rail New (global/workspace) or editor Where control.
        const packScope = scope
        void run(async () => {
          const saved = await importPack(sessionId, {
            scope: packScope,
            zipBase64: bytesToBase64(bytes),
          })
          setSelectedId(saved.id)
          setExportHint(t('team.importPackOk'))
        })
        return
      }
      void run(async () => {
        const saved = await upsertTeamMember(sessionId, {
          name: card.name,
          playbook: card.playbook,
          role: card.role,
          scope,
          kind: 'thin',
          ready: true,
          ...(card.brief ? { brief: card.brief } : {}),
          ...(card.inject ? { inject: card.inject } : {}),
          ...(card.tools ? { tools: card.tools } : {}),
        })
        setSelectedId(saved.id)
        setExportHint(t('team.importOk'))
      })
    })
  }

  const liveTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => {
    if (liveTimer.current !== undefined) window.clearTimeout(liveTimer.current)
  }, [])

  type LiveLookPatch = {
    readonly shape?: string
    readonly color?: string
    readonly kitHat?: string
    readonly kitGlasses?: string
    readonly kitHeld?: string
    readonly nickname?: string
  }

  /** Quiet upsert — no busy spinner / full reload (matches 老板席 hot path). */
  const flushLivePersist = async (patch: LiveLookPatch = {}) => {
    if (sessionId === undefined || selectedId === null || bossSelected) return
    if (isDraftMemberId(selectedId)) return
    if (catalogSeed && !managerSelected && !selected) return
    const nextShape = patch.shape ?? shape
    const nextColor = patch.color ?? color
    const nextHat = patch.kitHat ?? kitHat
    const nextGlasses = patch.kitGlasses ?? kitGlasses
    const nextHeld = patch.kitHeld ?? kitHeld
    const nextNick = patch.nickname ?? nickname
    const names = splitToolNames(toolsNames)
    const tools =
      toolsMode === 'inherit'
        ? (selected?.tools ? null : undefined)
        : names.length > 0
          ? { mode: toolsMode, names }
          : null
    const appearance = {
      shape: nextShape,
      color: nextColor,
      kit: resolveEnginePick(nextHat, HAT_BUILTINS) !== 'none'
        ? resolveEnginePick(nextHat, HAT_BUILTINS)
        : resolveEnginePick(nextGlasses, GLASSES_BUILTINS),
      kitHat: nextHat,
      kitGlasses: nextGlasses,
      kitHeld: nextHeld,
    }
    try {
      setError(null)
      let saved: AgentTeamMemberRow
      if (catalogSeed && selected) {
        saved = await upsertTeamMember(sessionId, {
          id: selected.id,
          name: selected.name,
          playbook: selected.playbook,
          role: selected.role,
          scope: 'global',
          appearance,
          ...(!sunflowerSelected
            ? { nickname: nextNick.trim() || null }
            : {}),
        })
      } else {
        if (name.trim() === '' || playbook.trim() === '') return
        saved = await upsertTeamMember(sessionId, {
          name: name.trim(),
          playbook: playbook.trim(),
          role,
          scope,
          inject,
          brief: brief.trim(),
          nickname: nextNick.trim() || null,
          ...(tools !== undefined ? { tools } : {}),
          ...(selected ? { id: selected.id } : {}),
          appearance,
        })
      }
      setMembers((prev) => {
        const index = prev.findIndex((row) => row.id === saved.id)
        const prior = index < 0 ? undefined : prev[index]
        // Merge: wire must keep appearance; never replace a full seat with a
        // stub `{ id }` (that painted the cream white ball after a live save).
        const merged: AgentTeamMemberRow = {
          ...(prior ?? {
            id: saved.id,
            name: '',
            playbook: '',
            role: 'default',
            updatedAt: Date.now(),
          }),
          ...saved,
          appearance: saved.appearance ?? prior?.appearance,
          nickname: saved.nickname !== undefined ? saved.nickname : prior?.nickname,
        }
        if (index < 0) return [...prev, merged]
        const next = prev.slice()
        next[index] = merged
        return next
      })
      if (selectedId !== saved.id) setSelectedId(saved.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const scheduleLivePersist = (patch: LiveLookPatch = {}) => {
    if (selectedId === null || bossSelected || isDraftMemberId(selectedId)) return
    const id = selectedId
    const lookTouched = patch.shape !== undefined
      || patch.color !== undefined
      || patch.kitHat !== undefined
      || patch.kitGlasses !== undefined
      || patch.kitHeld !== undefined
    const nextAppearance = {
      shape: patch.shape ?? shape,
      color: patch.color ?? color,
      kitHat: patch.kitHat ?? kitHat,
      kitGlasses: patch.kitGlasses ?? kitGlasses,
      kitHeld: patch.kitHeld ?? kitHeld,
    }
    const nextNick = patch.nickname !== undefined ? patch.nickname : nickname
    // Optimistic seat paint before the upsert round-trip returns.
    if (lookTouched || patch.nickname !== undefined) {
      setMembers((prev) => prev.map((row) => {
        if (row.id !== id) return row
        return {
          ...row,
          appearance: {
            shape: nextAppearance.shape,
            color: nextAppearance.color,
            kitHat: nextAppearance.kitHat,
            kitGlasses: nextAppearance.kitGlasses,
            kitHeld: nextAppearance.kitHeld,
            ...(row.appearance?.kit ? { kit: row.appearance.kit } : {}),
            ...(row.appearance?.face ? { face: row.appearance.face } : {}),
            ...(row.appearance?.overlayHat ? { overlayHat: row.appearance.overlayHat } : {}),
            ...(row.appearance?.overlayGlasses ? { overlayGlasses: row.appearance.overlayGlasses } : {}),
            ...(row.appearance?.overlayHeld ? { overlayHeld: row.appearance.overlayHeld } : {}),
          },
          ...(patch.nickname !== undefined
            ? { nickname: patch.nickname.trim() || undefined }
            : {}),
        }
      }))
    }
    // Nick only when this persist touched it — look-only must not push
    // nickname:null (that cleared Face formal（nick） on Overview).
    patchTeamRosterLive(id, {
      name: name.trim() || null,
      ...(patch.nickname !== undefined
        ? { nickname: nextNick.trim() || null }
        : {}),
      ...(lookTouched ? { appearance: nextAppearance } : {}),
    })
    if (liveTimer.current !== undefined) window.clearTimeout(liveTimer.current)
    liveTimer.current = window.setTimeout(() => {
      liveTimer.current = undefined
      void flushLivePersist(patch)
    }, 280)
  }

  /** Draft create / Ctrl+Enter — still explicit. */
  const persistMember = () => {
    if (sessionId === undefined || busy || selectedId === null) return
    if (isDraftMemberId(selectedId) && (name.trim() === '' || playbook.trim() === '')) return
    if (catalogSeed && !managerSelected && !selected) return
    if (!isDraftMemberId(selectedId)) {
      void flushLivePersist()
      return
    }
    void run(async () => {
      const names = splitToolNames(toolsNames)
      const tools =
        toolsMode === 'inherit'
          ? undefined
          : names.length > 0
            ? { mode: toolsMode, names }
            : null
      const appearance = {
        shape,
        color,
        kit: resolveEnginePick(kitHat, HAT_BUILTINS) !== 'none'
          ? resolveEnginePick(kitHat, HAT_BUILTINS)
          : resolveEnginePick(kitGlasses, GLASSES_BUILTINS),
        kitHat,
        kitGlasses,
        kitHeld,
      }
      if (name.trim() === '' || playbook.trim() === '') return
      const saved = await upsertTeamMember(sessionId, {
        name: name.trim(),
        playbook: playbook.trim(),
        role,
        scope,
        inject,
        brief: brief.trim(),
        nickname: nickname.trim() || null,
        ...(tools !== undefined ? { tools } : {}),
        appearance,
      })
      setSelectedId(saved.id)
    })
  }

  const draftCreateLabel = selected?.scope === 'global' && scope === 'workspace'
    ? t('team.saveOverride')
    : selected?.scope === 'workspace' && scope === 'global'
      ? t('team.savePromote')
      : t('team.memberCreate')
  const canCreateDraft = !busy && isDraftMemberId(selectedId)
    && name.trim() !== '' && playbook.trim() !== ''

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t('close')}
      title={t('team.title')}
      className={css.dialogWide}
      contentClassName={css.sheet}
    >
      {sessionId === undefined ? (
        <p className={css.hint}>{t('team.needSession')}</p>
      ) : (
        <div
          className={css.body}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              persistMember()
            }
          }}
        >
          <div className={css.layout}>
            <aside className={css.rail}>
              <section className={css.section}>
                <h3 className={css.heading}>{t('team.members')}</h3>
                <p className={css.subhead}>{t('team.seats')}</p>
                <div className={presenceOn ? css.ballFieldSeats : css.ballFieldList}>
                  <BossSeatBall
                    selected={bossSelected}
                    disabled={busy}
                    displayName={
                      bossNickname.trim()
                        || t('team.boss', { boss: seatTitles.boss })
                    }
                    look={bossRailLook}
                    presenceOn={presenceOn}
                    seedLabel={t('team.seed')}
                    onSelect={() => {
                      setSelectedId('boss')
                      setError(null)
                      setExportHint(null)
                    }}
                  />
                  {seatMembers.map((member) => (
                    <MemberBall
                      key={member.id}
                      member={member}
                      displayName={catalogMemberName(
                        member.id, member.name, t, seatTitles,
                      )}
                      displayBrief={catalogMemberBrief(
                        member.id, member.brief, t, seatTitles,
                      )}
                      stickers={stickers}
                      selected={selectedId === member.id}
                      disabled={busy}
                      seedLabel={t('team.seed')}
                      advancedLabel={t('team.advanced')}
                      notReadyLabel={t('team.notReady')}
                      roleLabel={t(`team.role.${member.role ?? 'default'}` as WorkspaceKey)}
                      presenceOn={presenceOn}
                      onSelect={() => {
                        setSelectedId(member.id)
                        loadMember(member)
                      }}
                    />
                  ))}
                </div>
                <p className={css.subhead}>{t('team.global')}</p>
                <div className={presenceOn ? css.ballField : css.ballFieldList}>
                  {globalMembers.map((member) => (
                    <MemberBall
                      key={member.id}
                      member={member}
                      displayName={catalogMemberName(member.id, member.name, t, seatTitles)}
                      displayBrief={catalogMemberBrief(member.id, member.brief, t, seatTitles)}
                      stickers={stickers}
                      selected={selectedId === member.id}
                      disabled={busy}
                      seedLabel={t('team.seed')}
                      advancedLabel={t('team.advanced')}
                      notReadyLabel={t('team.notReady')}
                      roleLabel={t(`team.role.${member.role ?? 'default'}` as WorkspaceKey)}
                      presenceOn={presenceOn}
                      onSelect={() => {
                        setSelectedId(member.id)
                        loadMember(member)
                      }}
                    />
                  ))}
                  <NewMemberBall
                    selected={selectedId === 'new-global'}
                    disabled={busy}
                    caption={t('team.memberNew')}
                    label={t('team.memberNewGlobal')}
                    presenceOn={presenceOn}
                    onSelect={() => {
                      setSelectedId('new-global')
                      loadMember(undefined)
                      setScope('global')
                    }}
                  />
                </div>
                <p className={css.subhead}>{t('team.workspace')}</p>
                <div className={css.workspaceBar}>
                  <span className={css.workspaceIdentity}>
                    <IconFolderCloseRegular size={16} />
                    <span className={css.workspaceTitle}>
                      {currentWorkspace?.title ?? t('team.workspaceNone')}
                    </span>
                  </span>
                  <div ref={wsPickRef}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-expanded={wsPickOpen}
                      aria-haspopup="menu"
                      onClick={() => { setWsPickOpen(open => !open) }}
                    >
                      {t('team.workspacePick')}
                    </Button>
                  </div>
                </div>
                <WorkspacePickFlow
                  t={t}
                  open={wsPickOpen}
                  anchorRef={wsPickRef}
                  useWorkspaces={useWorkspaces}
                  createWorkspace={createWorkspace}
                  useDirectoryFlow={useDirectoryFlow}
                  renderDirectoryFlow={renderDirectoryFlow}
                  selectedId={currentWorkspace?.workspaceId}
                  // Team binds 干员 to project trees — never list agent homes here.
                  listKind="project"
                  side="bottom"
                  onPick={(workspaceId) => {
                    setWsPickOpen(false)
                    startSession(workspaceId)
                  }}
                  onClose={() => { setWsPickOpen(false) }}
                />
                {workspaceGroups.length === 0 ? (
                  <p className={css.empty}>{t('team.workspaceEmpty')}</p>
                ) : null}
                {workspaceGroups.map((group) => (
                  <div key={group.workspaceId} className={css.workspaceGroup}>
                    <p className={css.workspaceGroupHead}>
                      <IconFolderCloseRegular size={14} />
                      <span className={css.workspaceGroupTitle}>{group.title}</span>
                      {group.current
                        ? <span className={css.workspaceGroupBadge}>{t('team.workspaceCurrent')}</span>
                        : null}
                    </p>
                    {group.members.length === 0 && !group.current ? (
                      <p className={css.empty}>{t('team.workspaceOtherEmpty')}</p>
                    ) : null}
                    <div className={presenceOn ? css.ballField : css.ballFieldList}>
                      {group.members.map((member) => (
                        <MemberBall
                          key={`${group.workspaceId}:${member.id}`}
                          member={member}
                          displayName={catalogMemberName(member.id, member.name, t, seatTitles)}
                          displayBrief={catalogMemberBrief(member.id, member.brief, t, seatTitles)}
                          stickers={stickers}
                          selected={selectedId === member.id}
                          disabled={busy}
                          seedLabel={t('team.seed')}
                          advancedLabel={t('team.advanced')}
                          notReadyLabel={t('team.notReady')}
                          roleLabel={t(`team.role.${member.role ?? 'default'}` as WorkspaceKey)}
                          presenceOn={presenceOn}
                          onSelect={() => {
                            if (
                              member.workspaceId
                              && currentWorkspace?.workspaceId
                              && member.workspaceId !== currentWorkspace.workspaceId
                            ) {
                              startSession(member.workspaceId as WorkspaceId)
                            }
                            setSelectedId(member.id)
                            loadMember(member)
                          }}
                        />
                      ))}
                      {group.current ? (
                        <NewMemberBall
                          selected={selectedId === 'new-workspace'}
                          disabled={busy}
                          caption={t('team.memberNew')}
                          label={t('team.memberNewWorkspace')}
                          presenceOn={presenceOn}
                          onSelect={() => {
                            setSelectedId('new-workspace')
                            loadMember(undefined)
                            setScope('workspace')
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                ))}
              </section>
            </aside>

            <div className={css.pane}>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json,application/zip,.zip"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) importMemberFromFile(file)
                }}
              />
              {selectedId === null ? (
                <div className={css.editorEmpty}>
                  <p>{t('team.editorEmpty')}</p>
                  <ol className={css.howTo}>
                    <li>{t('team.howTo.pick')}</li>
                    <li>{t('team.howTo.edit')}</li>
                    <li>{t('team.howTo.share')}</li>
                  </ol>
                </div>
              ) : bossSelected ? (
                <div className={css.editor}>
                  <p className={css.fieldHint}>
                    {t('team.bossHint', { boss: seatTitles.boss })}
                  </p>
                  <div className={css.field}>
                    <label className={css.label} htmlFor="team-boss-nickname">
                      {t('team.bossNickname')}
                    </label>
                    <input
                      id="team-boss-nickname"
                      className={css.input}
                      value={bossNickDraft}
                      maxLength={BOSS_NICKNAME_MAX}
                      placeholder={t('team.bossNicknamePlaceholder')}
                      disabled={busy}
                      onChange={(e) => { setBossNickDraft(e.target.value) }}
                      onBlur={() => { setBossNickname(bossNickDraft) }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          setBossNickname(bossNickDraft)
                          ;(e.target as HTMLInputElement).blur()
                        }
                      }}
                    />
                    <p className={css.fieldHint}>{t('team.bossLive')}</p>
                  </div>
                  <div className={css.field}>
                    <span className={css.label}>{t('team.bossLook', { boss: seatTitles.boss })}</span>
                    {!presenceOn ? (
                      <p className={css.presenceOff} role="status">{t('team.presenceOff')}</p>
                    ) : (
                      <>
                        <CompanionBall
                          shape={bossLook.shape}
                          color={bossLook.color}
                          kitHat={resolveEnginePick(bossLook.kitHat, HAT_BUILTINS)}
                          kitGlasses={resolveEnginePick(bossLook.kitGlasses, GLASSES_BUILTINS)}
                          kitHeld={resolveEnginePick(bossLook.kitHeld, HELD_BUILTINS)}
                          overlayHat={resolveStickerOverlay(bossLook.kitHat, stickers)}
                          overlayGlasses={resolveStickerOverlay(bossLook.kitGlasses, stickers)}
                          overlayHeld={resolveStickerOverlay(bossLook.kitHeld, stickers)}
                        />
                        <div className={css.picks} role="group" aria-label={t('team.shape')}>
                          {COMPANION_SHAPES.map((id) => (
                            <button
                              key={id}
                              type="button"
                              className={bossLook.shape === id ? css.pickOn : css.pick}
                              aria-label={t(`team.shape.${id}` as WorkspaceKey)}
                              aria-pressed={bossLook.shape === id}
                              disabled={busy}
                              onClick={() => { setBossLookField('shape', id) }}
                            >
                              <CompanionShapeGlyph shape={id} />
                            </button>
                          ))}
                        </div>
                        <div className={css.picks} role="group" aria-label={t('team.color')}>
                          {COMPANION_COLORS.map((id) => (
                            <button
                              key={id}
                              type="button"
                              className={bossLook.color === id ? css.swatchOn : css.swatch}
                              style={{ background: companionPaint(id, false).body }}
                              aria-label={t(`team.color.${id}` as WorkspaceKey)}
                              aria-pressed={bossLook.color === id}
                              disabled={busy}
                              onClick={() => { setBossLookField('color', id) }}
                            />
                          ))}
                        </div>
                        <p className={css.faceHint}>{t('team.overlayHint')}</p>
                        {([
                          ['hat', bossLook.kitHat, 'kitHat', HAT_BUILTINS],
                          ['glasses', bossLook.kitGlasses, 'kitGlasses', GLASSES_BUILTINS],
                          ['held', bossLook.kitHeld, 'kitHeld', HELD_BUILTINS],
                        ] as const).map(([slot, pick, field, builtins]) => (
                          <div
                            key={slot}
                            className={css.picks}
                            role="group"
                            aria-label={t(`team.overlay.${slot}` as WorkspaceKey)}
                          >
                            {builtins.map((id) => (
                              <button
                                key={id}
                                type="button"
                                className={pick === id ? css.pickOn : css.pick}
                                aria-label={t(`team.kit.${id}` as WorkspaceKey)}
                                aria-pressed={pick === id}
                                disabled={busy}
                                onClick={() => { setBossLookField(field, id) }}
                              >
                                <CompanionKitMark
                                  kit={id}
                                  {...(css.kitGlyph ? { className: css.kitGlyph } : {})}
                                />
                              </button>
                            ))}
                            {stickersForSlot(stickers, slot).map((row) => {
                              const ref = stickerRef(row.id)
                              return (
                                <div
                                  key={row.id}
                                  className={pick === ref ? css.overlayCubeOn : css.overlayCube}
                                >
                                  <button
                                    type="button"
                                    className={css.pick}
                                    disabled={busy}
                                    aria-pressed={pick === ref}
                                    onClick={() => { setBossLookField(field, ref) }}
                                  >
                                    <span
                                      className={css.overlayThumb}
                                      style={{ backgroundImage: `url(${row.image})` }}
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    className={css.overlayClear}
                                    disabled={busy}
                                    aria-label={t('team.faceClear')}
                                    onClick={() => {
                                      removeDressingSticker(row.id)
                                      if (pick === ref) setBossLookField(field, 'none')
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              )
                            })}
                            <div className={css.overlayAdd}>
                              <span className={css.overlayEmpty}>+</span>
                              <input
                                className={css.overlayFile}
                                type="file"
                                accept="image/svg+xml,image/png,image/jpeg,image/webp,image/gif"
                                disabled={busy}
                                aria-label={t(`team.overlay.${slot}` as WorkspaceKey)}
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  e.target.value = ''
                                  if (!file) return
                                  const reader = new FileReader()
                                  reader.onload = () => {
                                    const next = String(reader.result ?? '')
                                    if (next.length > FACE_MAX) {
                                      setError(t('team.faceTooBig'))
                                      return
                                    }
                                    const id = addDressingSticker(next, slot)
                                    if (!id) {
                                      setError(t('team.faceTooBig'))
                                      return
                                    }
                                    setBossLookField(field, stickerRef(id))
                                  }
                                  reader.readAsDataURL(file)
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className={css.editor}>
                  {managerSelected ? (
                    <p className={css.fieldHint}>{t('team.managerHint', { manager: seatTitles.manager })}</p>
                  ) : sunflowerSelected ? (
                    <p className={css.fieldHint}>{t('team.sunflowerHint')}</p>
                  ) : catalogSeed ? (
                    <p className={css.fieldHint}>{t('team.catalogHint')}</p>
                  ) : null}
                  {isDraftMemberId(selectedId) || managerSelected || sunflowerSelected ? null : (
                    <p className={css.fieldHint}>{t('team.editorHint')}</p>
                  )}
                  <fieldset className={css.editorLock} disabled={busy || fieldsLocked}>
                  <div className={css.field}>
                    <label className={css.label} htmlFor="team-member-name">{t('team.memberName')}</label>
                    <input
                      id="team-member-name"
                      className={css.input}
                      value={name}
                      placeholder={t('team.memberName')}
                      disabled={busy}
                      onChange={(e) => { setName(e.target.value) }}
                      onBlur={() => { scheduleLivePersist() }}
                    />
                  </div>
                  <div className={css.field}>
                    <label className={css.label} htmlFor="team-member-brief">{t('team.memberBrief')}</label>
                    <input
                      id="team-member-brief"
                      className={css.input}
                      value={brief}
                      placeholder={t('team.briefPlaceholder')}
                      disabled={busy}
                      onChange={(e) => { setBrief(e.target.value) }}
                      onBlur={() => { scheduleLivePersist() }}
                    />
                  </div>
                  <div className={css.pair}>
                    <div className={css.field}>
                      <span className={css.label} id="team-role-label">{t('team.role')}</span>
                      <p className={css.fieldHint}>{t('team.roleHint')}</p>
                      <select
                        className={css.select}
                        aria-labelledby="team-role-label"
                        disabled={busy}
                        value={role}
                        onChange={(e) => {
                          setRole(e.target.value as SpawnRole)
                          scheduleLivePersist()
                        }}
                      >
                        {ROLES.map((id) => (
                          <option key={id} value={id}>{t(`team.role.${id}` as WorkspaceKey)}</option>
                        ))}
                      </select>
                    </div>
                    <div className={css.field}>
                      <span className={css.label} id="team-scope-label">{t('team.scope')}</span>
                      {selected !== undefined
                        && ((selected.scope === 'global' && scope === 'workspace')
                          || (selected.scope === 'workspace' && scope === 'global'))
                        ? (
                            <p className={css.fieldHint}>
                              {scope === 'workspace'
                                ? t('team.scopeHint')
                                : t('team.scopeHintPromote')}
                            </p>
                          )
                        : null}
                      <div className={css.seg} role="group" aria-labelledby="team-scope-label">
                        <button
                          type="button"
                          className={scope === 'global' ? css.segOn : css.segOff}
                          aria-pressed={scope === 'global'}
                          disabled={busy}
                          onClick={() => { setScope('global') }}
                        >
                          {t('team.global')}
                        </button>
                        <button
                          type="button"
                          className={scope === 'workspace' ? css.segOn : css.segOff}
                          aria-pressed={scope === 'workspace'}
                          disabled={busy}
                          onClick={() => { setScope('workspace') }}
                        >
                          {t('team.workspace')}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className={css.field}>
                    <span className={css.label} id="team-inject-label">{t('team.inject')}</span>
                    <p className={css.fieldHint}>{t('team.injectHint')}</p>
                    <div className={css.seg} role="group" aria-labelledby="team-inject-label">
                      <button
                        type="button"
                        className={inject === 'minimal' ? css.segOn : css.segOff}
                        aria-pressed={inject === 'minimal'}
                        disabled={busy}
                        onClick={() => { setInject('minimal') }}
                      >
                        {t('team.injectMinimal')}
                      </button>
                      <button
                        type="button"
                        className={inject === 'subagent' ? css.segOn : css.segOff}
                        aria-pressed={inject === 'subagent'}
                        disabled={busy}
                        onClick={() => { setInject('subagent') }}
                      >
                        {t('team.injectSubagent')}
                      </button>
                    </div>
                  </div>
                  <div className={css.field}>
                    <span className={css.label} id="team-tools-label">{t('team.tools')}</span>
                    <p className={css.fieldHint}>{t('team.toolsHint')}</p>
                    <div className={css.seg} role="group" aria-labelledby="team-tools-label">
                      {(['inherit', 'allow', 'deny'] as const).map((id) => (
                        <button
                          key={id}
                          type="button"
                          className={toolsMode === id ? css.segOn : css.segOff}
                          aria-pressed={toolsMode === id}
                          disabled={busy}
                          onClick={() => { setToolsMode(id) }}
                        >
                          {t(`team.tools.${id}` as WorkspaceKey)}
                        </button>
                      ))}
                    </div>
                    {toolsMode !== 'inherit' ? (
                      <>
                        <input
                          className={css.input}
                          value={toolsNames}
                          placeholder={t('team.toolsNamesPlaceholder')}
                          aria-label={t('team.toolsNamesPlaceholder')}
                          disabled={busy}
                          onChange={(e) => { setToolsNames(e.target.value) }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setToolsMode('allow')
                            setToolsNames(FILE_TOOLS)
                          }}
                        >
                          {t('team.toolsFileSet')}
                        </Button>
                      </>
                    ) : null}
                  </div>
                  <div className={css.field}>
                    <label className={css.label} htmlFor="team-playbook">{t('team.memberPlaybook')}</label>
                    <textarea
                      id="team-playbook"
                      className={css.textarea}
                      value={playbook}
                      placeholder={t('team.playbookPlaceholder')}
                      disabled={busy}
                      rows={5}
                      onChange={(e) => { setPlaybook(e.target.value) }}
                      onBlur={() => { scheduleLivePersist() }}
                    />
                  </div>
                  </fieldset>
                  <div className={css.field}>
                    <label className={css.label} htmlFor="team-member-nickname">{t('team.memberNickname')}</label>
                    <input
                      id="team-member-nickname"
                      className={css.input}
                      value={nickname}
                      maxLength={24}
                      placeholder={t('team.nicknamePlaceholder')}
                      disabled={busy || nicknameLocked}
                      onChange={(e) => { setNickname(e.target.value) }}
                      onBlur={() => {
                        if (nicknameLocked) return
                        scheduleLivePersist({ nickname })
                      }}
                    />
                    {sunflowerSelected
                      ? <p className={css.fieldHint}>{t('team.nicknameLocked')}</p>
                      : <p className={css.fieldHint}>{t('team.nicknameHint')}</p>}
                  </div>
                  <fieldset className={css.editorLock} disabled={busy || appearanceLocked}>
                  <div className={css.field}>
                    <span className={css.label}>{t('team.look')}</span>
                    {!presenceOn ? (
                      <p className={css.presenceOff} role="status">{t('team.presenceOff')}</p>
                    ) : (
                    <>
                    <CompanionBall
                      shape={shape}
                      color={color}
                      kitHat={resolveEnginePick(kitHat, HAT_BUILTINS)}
                      kitGlasses={resolveEnginePick(kitGlasses, GLASSES_BUILTINS)}
                      kitHeld={resolveEnginePick(kitHeld, HELD_BUILTINS)}
                      overlayHat={resolveStickerOverlay(kitHat, stickers)}
                      overlayGlasses={resolveStickerOverlay(kitGlasses, stickers)}
                      overlayHeld={resolveStickerOverlay(kitHeld, stickers)}
                    />
                    <div className={css.picks} role="group" aria-label={t('team.shape')}>
                      {COMPANION_SHAPES.map((id) => (
                        <button
                          key={id}
                          type="button"
                          className={shape === id ? css.pickOn : css.pick}
                          aria-label={t(`team.shape.${id}` as WorkspaceKey)}
                          aria-pressed={shape === id}
                          disabled={busy}
                          onClick={() => {
                            setShape(id)
                            scheduleLivePersist({ shape: id })
                          }}
                        >
                          <CompanionShapeGlyph shape={id} />
                        </button>
                      ))}
                    </div>
                    <div className={css.picks} role="group" aria-label={t('team.color')}>
                      {COMPANION_COLORS.map((id) => (
                        <button
                          key={id}
                          type="button"
                          className={color === id ? css.swatchOn : css.swatch}
                          style={{ background: companionPaint(id, false).body }}
                          aria-label={t(`team.color.${id}` as WorkspaceKey)}
                          aria-pressed={color === id}
                          disabled={busy}
                          onClick={() => {
                            setColor(id)
                            scheduleLivePersist({ color: id })
                          }}
                        />
                      ))}
                    </div>
                    <p className={css.faceHint}>{t('team.overlayHint')}</p>
                    {([
                      ['hat', kitHat, setKitHat, HAT_BUILTINS, 'kitHat'] as const,
                      ['glasses', kitGlasses, setKitGlasses, GLASSES_BUILTINS, 'kitGlasses'] as const,
                      ['held', kitHeld, setKitHeld, HELD_BUILTINS, 'kitHeld'] as const,
                    ]).map(([slot, pick, setPick, builtins, patchKey]) => {
                      const applyKit = (next: string) => {
                        setPick(next)
                        scheduleLivePersist({ [patchKey]: next })
                      }
                      return (
                      <div key={slot} className={css.picks} role="group" aria-label={t(`team.overlay.${slot}` as WorkspaceKey)}>
                        {builtins.map((id) => (
                          <button
                            key={id}
                            type="button"
                            className={pick === id ? css.pickOn : css.pick}
                            aria-label={t(`team.kit.${id}` as WorkspaceKey)}
                            aria-pressed={pick === id}
                            disabled={busy}
                            onClick={() => { applyKit(id) }}
                          >
                            <CompanionKitMark kit={id} {...(css.kitGlyph ? { className: css.kitGlyph } : {})} />
                          </button>
                        ))}
                        {stickersForSlot(stickers, slot).map((row) => {
                          const ref = stickerRef(row.id)
                          return (
                            <div key={row.id} className={pick === ref ? css.overlayCubeOn : css.overlayCube}>
                              <button
                                type="button"
                                className={css.pick}
                                disabled={busy}
                                aria-pressed={pick === ref}
                                onClick={() => { applyKit(ref) }}
                              >
                                <span className={css.overlayThumb} style={{ backgroundImage: `url(${row.image})` }} />
                              </button>
                              <button
                                type="button"
                                className={css.overlayClear}
                                disabled={busy}
                                aria-label={t('team.faceClear')}
                                onClick={() => {
                                  removeDressingSticker(row.id)
                                  if (pick === ref) applyKit('none')
                                }}
                              >
                                ×
                              </button>
                            </div>
                          )
                        })}
                        <div className={css.overlayAdd}>
                          <span className={css.overlayEmpty}>+</span>
                          <input
                            className={css.overlayFile}
                            type="file"
                            accept="image/svg+xml,image/png,image/jpeg,image/webp,image/gif"
                            disabled={busy}
                            aria-label={t(`team.overlay.${slot}` as WorkspaceKey)}
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              e.target.value = ''
                              if (!file) return
                              const reader = new FileReader()
                              reader.onload = () => {
                                const next = String(reader.result ?? '')
                                if (next.length > FACE_MAX) {
                                  setError(t('team.faceTooBig'))
                                  return
                                }
                                const id = addDressingSticker(next, slot)
                                if (!id) {
                                  setError(t('team.faceTooBig'))
                                  return
                                }
                                applyKit(stickerRef(id))
                              }
                              reader.readAsDataURL(file)
                            }}
                          />
                        </div>
                      </div>
                      )
                    })}
                    </>
                    )}
                  </div>
                  </fieldset>
                  {selected !== undefined && !isDraftMemberId(selectedId) && selected.ready === false ? (
                    <div className={css.readyGate} role="note">
                      <div className={css.readyGateHead}>
                        <span className={css.notReadyBadge}>{t('team.notReady')}</span>
                      </div>
                      {selected.envPrep ? (
                        <>
                          <div className={css.readyGateLabel}>{t('team.envPrepLabel')}</div>
                          <pre className={css.envPrep}>{selected.envPrep}</pre>
                        </>
                      ) : (
                        <p className={css.fieldHint}>
                          {selected.envHint ?? t('team.readyHint')}
                        </p>
                      )}
                      <div className={css.readyGateActions}>
                        <Button
                          variant="primary"
                          disabled={busy}
                          onClick={() => {
                            void run(async () => {
                              const saved = await upsertTeamMember(sessionId!, {
                                name: selected.name,
                                playbook: selected.playbook,
                                role: selected.role,
                                id: selected.id,
                                scope: selected.scope === 'global' ? 'global' : 'workspace',
                                kind: 'advanced',
                                ready: true,
                                ...(selected.brief ? { brief: selected.brief } : {}),
                                ...(selected.inject === 'subagent' || selected.inject === 'minimal'
                                  ? { inject: selected.inject }
                                  : {}),
                                ...(selected.tools
                                  ? {
                                      tools: {
                                        mode: selected.tools.mode === 'deny' ? 'deny' : 'allow',
                                        names: selected.tools.names,
                                      },
                                    }
                                  : {}),
                              })
                              setSelectedId(saved.id)
                              setExportHint(t('team.readyOk'))
                            })
                          }}
                        >
                          {t('team.markReady')}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <div className={css.row}>
                    {catalogSeed && !managerSelected ? (
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() => {
                          setSelectedId('new-workspace')
                          setScope('workspace')
                        }}
                      >
                        {t('team.cloneFrom')}
                      </Button>
                    ) : isDraftMemberId(selectedId) ? (
                      <Button
                        variant="primary"
                        disabled={!canCreateDraft}
                        onClick={() => { persistMember() }}
                      >
                        {draftCreateLabel}
                      </Button>
                    ) : (
                      <p className={css.fieldHint}>{t('team.memberLive')}</p>
                    )}
                    {isDraftMemberId(selectedId) ? (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => { importRef.current?.click() }}
                      >
                        {t('team.import')}
                      </Button>
                    ) : null}
                    {canExport ? (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          const doExport = exportTeamMember
                          if (doExport !== undefined && sessionId !== undefined) {
                            void run(async () => {
                              const payload = await doExport(sessionId, selected.id)
                              downloadExportedMember(payload)
                              setExportHint(
                                payload.packIncomplete
                                  ? t('team.exportZipIncomplete')
                                  : payload.format === 'zip'
                                    ? t('team.exportZipOk')
                                    : t('team.exportJsonOk'),
                              )
                            })
                            return
                          }
                          try {
                            downloadMemberCardJson({
                              name: selected.name,
                              playbook: selected.playbook,
                              role: selected.role as SpawnRole,
                              ...(selected.brief ? { brief: selected.brief } : {}),
                              ...(selected.inject === 'subagent' || selected.inject === 'minimal'
                                ? { inject: selected.inject }
                                : {}),
                              ...(selected.tools
                                ? {
                                    tools: {
                                      mode: selected.tools.mode === 'deny' ? 'deny' : 'allow',
                                      names: selected.tools.names,
                                    },
                                  }
                                : {}),
                            })
                            setExportHint(t('team.exportJsonOk'))
                          } catch (err) {
                            setError(err instanceof Error ? err.message : t('team.exportFail'))
                          }
                        }}
                      >
                        {selected.kind === 'advanced' ? t('team.exportZip') : t('team.exportJson')}
                      </Button>
                    ) : null}
                    {canDelete && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          const remove = removeTeamMember
                          if (remove === undefined) return
                          void run(async () => {
                            await remove(sessionId, selected.id, selected.scope === 'global' ? 'global' : 'workspace')
                            setSelectedId(null)
                          })
                        }}
                      >
                        {t('team.memberDelete')}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          {exportHint !== null && (
            <div className={css.fieldHint} role="status">{exportHint}</div>
          )}
          {error !== null && <div className={css.error} role="alert">{error}</div>}
        </div>
      )}
    </Modal>
  )
}
