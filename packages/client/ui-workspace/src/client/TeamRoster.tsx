/**
 * Sidebar Agent Team: 干员 balls (shape / color / face).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconFolderClose16, Modal,
} from '@xrkseek/client-ui-primitives'
import type { SessionId, WorkspaceId } from '@xrkseek/client-runtime/client'
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
  removeDressingSticker,
  useDressingStickers,
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
  type DressingSlot,
  type DressingSticker,
} from './dressing-library.ts'
import css from './TeamRoster.module.css'

type Translate = WorkspaceBrowserProps['t']
type ToolMode = 'inherit' | 'allow' | 'deny'
type SpawnRole = 'default' | 'worker' | 'researcher' | 'reviewer' | 'lead'

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

function MemberBall({
  member,
  stickers,
  selected,
  disabled,
  seedLabel,
  onSelect,
}: {
  member: AgentTeamMemberRow
  stickers: readonly DressingSticker[]
  selected: boolean
  disabled: boolean
  seedLabel: string
  onSelect: () => void
}) {
  const look = appearanceOf(member, stickers)
  const title = member.brief ? `${member.name} — ${member.brief}` : member.name
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
      <span className={css.ballCaption}>
        <span className={css.ballName}>{member.name}</span>
        {member.catalog === true || member.seed === true
          ? <span className={css.seed}>{seedLabel}</span>
          : null}
      </span>
    </button>
  )
}

function isDraftMemberId(id: string | null): id is 'new-global' | 'new-workspace' {
  return id === 'new-global' || id === 'new-workspace'
}

function NewMemberBall({
  selected,
  disabled,
  caption,
  label,
  onSelect,
}: {
  selected: boolean
  disabled: boolean
  caption: string
  label: string
  onSelect: () => void
}) {
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
  dispatchTeam,
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
  dispatchTeam: NonNullable<WorkspaceBrowserProps['dispatchTeam']>
}) {
  const stickers = useDressingStickers()
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
  const [selectedId, setSelectedId] = useState<string | 'new-global' | 'new-workspace' | null>(null)
  const [name, setName] = useState('')
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
  const [task, setTask] = useState('')

  const selected = selectedId && !isDraftMemberId(selectedId)
    ? members.find(row => row.id === selectedId)
    : undefined
  const globalMembers = members.filter(row => row.scope === 'global')
  const workspaceMembers = members.filter(row => row.scope !== 'global')
  const catalogSeed = selected?.catalog === true
    && selected.scope === 'global'
  const canDelete = selected !== undefined
    && removeTeamMember !== undefined
    && !catalogSeed

  const reload = async () => {
    if (sessionId === undefined) return
    setMembers(await listTeam(sessionId))
  }

  const loadMember = (member: AgentTeamMemberRow | undefined) => {
    const look = member
      ? appearanceOf(member, stickers)
      : { shape: 'blob', color: 'cream', kitHat: 'none', kitGlasses: 'none', kitHeld: 'none' }
    setName(member?.name ?? '')
    setPlaybook(member?.playbook ?? '')
    setRole((ROLES.includes(member?.role as SpawnRole) ? member?.role : 'worker') as SpawnRole)
    setShape(look.shape)
    setColor(look.color)
    setKitHat(look.kitHat)
    setKitGlasses(look.kitGlasses)
    setKitHeld(look.kitHeld)
    setScope(member?.scope === 'global' ? 'global' : 'workspace')
    setInject(member?.inject === 'subagent' ? 'subagent' : 'minimal')
    setBrief(member?.brief ?? '')
    if (member?.tools?.names?.length) {
      setToolsMode(member.tools.mode === 'deny' ? 'deny' : 'allow')
      setToolsNames(member.tools.names.join(','))
    } else {
      setToolsMode('inherit')
      setToolsNames('')
    }
    setTask('')
  }

  useEffect(() => {
    if (!open) return
    setError(null)
    setSelectedId(null)
    setTask('')
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

  const persistMember = () => {
    if (sessionId === undefined || busy || name.trim() === '' || playbook.trim() === '' || selectedId === null) return
    if (catalogSeed) return
    void run(async () => {
      const names = splitToolNames(toolsNames)
      const tools =
        toolsMode === 'inherit'
          ? (selected?.tools ? null : undefined)
          : names.length > 0
            ? { mode: toolsMode, names }
            : null
      const saved = await upsertTeamMember(sessionId, {
        name: name.trim(),
        playbook: playbook.trim(),
        role,
        scope,
        inject,
        brief: brief.trim(),
        ...(tools !== undefined ? { tools } : {}),
        ...(selected ? { id: selected.id } : {}),
        appearance: {
          shape,
          color,
          kit: resolveEnginePick(kitHat, HAT_BUILTINS) !== 'none'
            ? resolveEnginePick(kitHat, HAT_BUILTINS)
            : resolveEnginePick(kitGlasses, GLASSES_BUILTINS),
          kitHat,
          kitGlasses,
          kitHeld,
        },
      })
      setSelectedId(saved.id)
    })
  }

  const saveLabel = selected?.scope === 'global' && scope === 'workspace'
    ? t('team.saveOverride')
    : selected?.scope === 'workspace' && scope === 'global'
      ? t('team.savePromote')
      : t('team.memberSave')

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
                <p className={css.subhead}>{t('team.global')}</p>
                <div className={css.ballField}>
                  {globalMembers.map((member) => (
                    <MemberBall
                      key={member.id}
                      member={member}
                      stickers={stickers}
                      selected={selectedId === member.id}
                      disabled={busy}
                      seedLabel={t('team.seed')}
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
                    <IconFolderClose16 size={16} />
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
                  side="bottom"
                  onPick={(workspaceId) => {
                    setWsPickOpen(false)
                    startSession(workspaceId)
                  }}
                  onClose={() => { setWsPickOpen(false) }}
                />
                {workspaceMembers.length === 0 ? (
                  <p className={css.empty}>{t('team.workspaceEmpty')}</p>
                ) : null}
                <div className={css.ballField}>
                  {workspaceMembers.map((member) => (
                    <MemberBall
                      key={member.id}
                      member={member}
                      stickers={stickers}
                      selected={selectedId === member.id}
                      disabled={busy}
                      seedLabel={t('team.seed')}
                      onSelect={() => {
                        setSelectedId(member.id)
                        loadMember(member)
                      }}
                    />
                  ))}
                  <NewMemberBall
                    selected={selectedId === 'new-workspace'}
                    disabled={busy}
                    caption={t('team.memberNew')}
                    label={t('team.memberNewWorkspace')}
                    onSelect={() => {
                      setSelectedId('new-workspace')
                      loadMember(undefined)
                      setScope('workspace')
                    }}
                  />
                </div>
              </section>
            </aside>

            <div className={css.pane}>
              {selectedId === null ? (
                <p className={css.editorEmpty}>{t('team.editorEmpty')}</p>
              ) : (
                <div className={css.editor}>
                  {catalogSeed ? (
                    <p className={css.fieldHint}>{t('team.catalogHint')}</p>
                  ) : null}
                  <fieldset className={css.editorLock} disabled={busy || catalogSeed}>
                  <div className={css.field}>
                    <label className={css.label} htmlFor="team-member-name">{t('team.memberName')}</label>
                    <input
                      id="team-member-name"
                      className={css.input}
                      value={name}
                      placeholder={t('team.memberName')}
                      disabled={busy}
                      onChange={(e) => { setName(e.target.value) }}
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
                        onChange={(e) => { setRole(e.target.value as SpawnRole) }}
                      >
                        {ROLES.map((id) => (
                          <option key={id} value={id}>{t(`team.role.${id}` as WorkspaceKey)}</option>
                        ))}
                      </select>
                    </div>
                    <div className={css.field}>
                      <span className={css.label} id="team-scope-label">{t('team.scope')}</span>
                      <p className={css.fieldHint}>{t('team.scopeHint')}</p>
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
                    <span className={css.label}>{t('team.look')}</span>
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
                          onClick={() => { setShape(id) }}
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
                          onClick={() => { setColor(id) }}
                        />
                      ))}
                    </div>
                    <p className={css.faceHint}>{t('team.overlayHint')}</p>
                    {([
                      ['hat', kitHat, setKitHat, HAT_BUILTINS],
                      ['glasses', kitGlasses, setKitGlasses, GLASSES_BUILTINS],
                      ['held', kitHeld, setKitHeld, HELD_BUILTINS],
                    ] as const).map(([slot, pick, setPick, builtins]) => (
                      <div key={slot} className={css.picks} role="group" aria-label={t(`team.overlay.${slot}` as WorkspaceKey)}>
                        {builtins.map((id) => (
                          <button
                            key={id}
                            type="button"
                            className={pick === id ? css.pickOn : css.pick}
                            aria-label={t(`team.kit.${id}` as WorkspaceKey)}
                            aria-pressed={pick === id}
                            disabled={busy}
                            onClick={() => { setPick(id) }}
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
                                onClick={() => { setPick(ref) }}
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
                                  if (pick === ref) setPick('none')
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
                            accept="image/png,image/jpeg,image/webp,image/gif"
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
                                setPick(stickerRef(id))
                              }
                              reader.readAsDataURL(file)
                            }}
                          />
                        </div>
                      </div>
                    ))}
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
                    />
                  </div>
                  </fieldset>
                  <div className={css.row}>
                    {catalogSeed ? (
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
                    ) : (
                      <Button
                        variant="primary"
                        disabled={busy || name.trim() === '' || playbook.trim() === ''}
                        onClick={() => { persistMember() }}
                      >
                        {saveLabel}
                      </Button>
                    )}
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
                  {selected && (
                    <div className={css.dispatch}>
                      <label className={css.label} htmlFor="team-task">{t('team.dispatch')}</label>
                      <p className={css.fieldHint}>{t('team.dispatchHint')}</p>
                      <textarea
                        id="team-task"
                        className={css.textarea}
                        value={task}
                        placeholder={t('team.taskPlaceholder')}
                        disabled={busy}
                        rows={5}
                        onChange={(e) => { setTask(e.target.value) }}
                      />
                      <Button
                        variant="primary"
                        disabled={busy || task.trim() === ''}
                        onClick={() => {
                          const next = task.trim()
                          void run(async () => {
                            await dispatchTeam(sessionId, selected.id, next)
                            setTask('')
                            onClose()
                          })
                        }}
                      >
                        {t('team.dispatchConfirm')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {error !== null && <div className={css.error} role="alert">{error}</div>}
        </div>
      )}
    </Modal>
  )
}
