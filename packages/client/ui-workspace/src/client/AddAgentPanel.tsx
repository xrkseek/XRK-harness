/**
 * Pick a Team roster member and mint their agent-home into the 干员 pane.
 * Distinct from TeamRoster（干员团队）which edits the roster itself.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Modal } from '@xrkseek/client-ui-primitives'
import type { SessionId, WorkspaceId } from '@xrkseek/client-runtime/client'
import type { AgentTeamMemberRow, WorkspaceBrowserProps } from './contract/slots.ts'
import {
  CompanionBall,
  companionPaint,
} from './CompanionBall.tsx'
import {
  useDressingStickers,
  usePresenceModuleEnabled,
  useSeatTitles,
} from './dressing-scope.ts'
import {
  GLASSES_BUILTINS,
  HAT_BUILTINS,
  HELD_BUILTINS,
  resolveEnginePick,
  resolveStickerOverlay,
  splitLegacyKit,
  stickerIdFromPick,
  type DressingSticker,
} from './dressing-library.ts'
import css from './AddAgentPanel.module.css'
import { catalogMemberName, isOfficeSeatMemberId } from './catalog-labels.ts'

type Translate = WorkspaceBrowserProps['t']

function appearanceOf(member: AgentTeamMemberRow, stickers: readonly DressingSticker[]) {
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
    engineHat: resolveEnginePick(kitHat, HAT_BUILTINS),
    engineGlasses: resolveEnginePick(kitGlasses, GLASSES_BUILTINS),
    engineHeld: resolveEnginePick(kitHeld, HELD_BUILTINS),
    ...(hatImg ? { overlayHat: hatImg } : {}),
    ...(glassesImg ? { overlayGlasses: glassesImg } : {}),
    ...(heldImg ? { overlayHeld: heldImg } : {}),
  }
}

function MemberTile({
  member,
  displayName,
  stickers,
  selected,
  disabled,
  alreadyAdded,
  alreadyLabel,
  originLabel,
  presenceOn,
  onSelect,
}: {
  member: AgentTeamMemberRow
  displayName: string
  stickers: readonly DressingSticker[]
  selected: boolean
  disabled: boolean
  alreadyAdded: boolean
  alreadyLabel: string
  originLabel: string
  presenceOn: boolean
  onSelect: () => void
}) {
  const look = appearanceOf(member, stickers)
  return (
    <button
      type="button"
      className={css.tile}
      data-selected={selected ? '' : undefined}
      data-added={alreadyAdded ? '' : undefined}
      disabled={disabled || alreadyAdded}
      onClick={onSelect}
      aria-label={displayName}
      title={`${displayName} · ${originLabel}`}
    >
      {presenceOn
        ? (
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
        : (
          <span
            className={css.initial}
            style={{ background: companionPaint(look.color, false).body }}
            aria-hidden
          >
            {displayName.trim().slice(0, 1) || '?'}
          </span>
        )}
      <span className={css.tileName}>{displayName}</span>
      <span className={css.tileOrigin}>{originLabel}</span>
      {alreadyAdded ? <span className={css.tileBadge}>{alreadyLabel}</span> : null}
    </button>
  )
}

export function AddAgentPanel({
  open,
  onClose,
  sessionId,
  t,
  boundMemberIds,
  workspaceTitleById,
  listTeam,
  upsertTeamMember,
  startSession,
  onOpenTeam,
}: {
  open: boolean
  onClose: () => void
  sessionId: SessionId | undefined
  t: Translate
  boundMemberIds: ReadonlySet<string>
  /** Project (+ other) workspace titles for roster origin labels. */
  workspaceTitleById: ReadonlyMap<string, string>
  listTeam: NonNullable<WorkspaceBrowserProps['listTeam']>
  upsertTeamMember: NonNullable<WorkspaceBrowserProps['upsertTeamMember']>
  startSession: (workspaceId?: WorkspaceId) => void
  onOpenTeam: () => void
}) {
  const stickers = useDressingStickers()
  const presenceOn = usePresenceModuleEnabled()
  const seatTitles = useSeatTitles()
  const [members, setMembers] = useState<readonly AgentTeamMemberRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const originOf = (member: AgentTeamMemberRow): string => {
    if (member.scope === 'workspace' && member.workspaceId) {
      const title = workspaceTitleById.get(member.workspaceId)?.trim()
      return t('agent.fromWorkspace', { name: title || member.workspaceId })
    }
    return t('agent.scopeGlobal')
  }

  useEffect(() => {
    if (!open) return
    setError(null)
    setSelectedId(null)
    if (sessionId === undefined) {
      setMembers([])
      return
    }
    void listTeam(sessionId).then(
      (rows) => { setMembers(rows) },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setMembers([])
      },
    )
  }, [open, sessionId, listTeam])

  /** 经理 / 向日葵 are office seats — open from TeamRoster, not mint 干员家 here. */
  const homeCandidates = useMemo(
    () => members.filter(row => !isOfficeSeatMemberId(row.id)),
    [members],
  )
  const selectable = useMemo(
    () => homeCandidates.filter(row => !boundMemberIds.has(row.id)),
    [homeCandidates, boundMemberIds],
  )
  const selected = selectedId
    ? homeCandidates.find(row => row.id === selectedId)
    : undefined
  const canAdd = selected !== undefined
    && !boundMemberIds.has(selected.id)
    && !isOfficeSeatMemberId(selected.id)
    && !busy

  const confirmAdd = () => {
    if (sessionId === undefined || selected === undefined || !canAdd) return
    setBusy(true)
    setError(null)
    void upsertTeamMember(sessionId, {
      id: selected.id,
      name: selected.name,
      playbook: selected.playbook,
      role: selected.role,
      scope: selected.scope === 'global' ? 'global' : 'workspace',
      mintHome: true,
      ...(selected.brief ? { brief: selected.brief } : {}),
      ...(selected.inject === 'subagent' || selected.inject === 'minimal'
        ? { inject: selected.inject }
        : {}),
      ...(selected.appearance ? { appearance: selected.appearance } : {}),
      ...(selected.kind === 'advanced' || selected.kind === 'thin'
        ? { kind: selected.kind }
        : {}),
      ...(typeof selected.ready === 'boolean' ? { ready: selected.ready } : {}),
    }).then((saved) => {
      setBusy(false)
      onClose()
      if (saved.homeWorkspaceId) startSession(saved.homeWorkspaceId as WorkspaceId)
    }, (err: unknown) => {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t('close')}
      title={t('agent.addWorkspace')}
      className={css.dialog}
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={!canAdd} onClick={confirmAdd}>
            {t('agent.pickConfirm')}
          </Button>
        </>
      )}
    >
      {sessionId === undefined ? (
        <p className={css.hint}>{t('team.needSession')}</p>
      ) : (
        <div className={css.body}>
          <p className={css.hint}>{t('agent.pickHint')}</p>
          {homeCandidates.length === 0 ? (
            <div className={css.empty}>
              <p>{t('agent.pickEmpty')}</p>
              <Button variant="outline" size="sm" onClick={() => { onClose(); onOpenTeam() }}>
                {t('team.title')}
              </Button>
            </div>
          ) : (
            <div className={css.grid} role="listbox" aria-label={t('agent.addWorkspace')}>
              {homeCandidates.map((member) => (
                <MemberTile
                  key={member.id}
                  member={member}
                  displayName={catalogMemberName(member.id, member.name, t, seatTitles)}
                  stickers={stickers}
                  selected={selectedId === member.id}
                  disabled={busy}
                  alreadyAdded={boundMemberIds.has(member.id)}
                  alreadyLabel={t('agent.alreadyAdded')}
                  originLabel={originOf(member)}
                  presenceOn={presenceOn}
                  onSelect={() => { setSelectedId(member.id) }}
                />
              ))}
            </div>
          )}
          {selectable.length === 0 && homeCandidates.length > 0 ? (
            <p className={css.hint}>{t('agent.pickAllAdded')}</p>
          ) : null}
          {error !== null ? <div className={css.error} role="alert">{error}</div> : null}
        </div>
      )}
    </Modal>
  )
}
