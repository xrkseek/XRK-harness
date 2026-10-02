/** Combined turn-tail: changed-files card + created / modified / deleted chip rows. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type { TurnTailOwnerProps } from '@xrkseek/client-ui-conversation/client'
import { ChangedFiles, type LoadFileDiff } from './ChangedFiles.tsx'
import { ProducedFiles, type ProducedFilesInjected } from './ProducedFiles.tsx'
import { selectDeliverables, type DeliverablesMatch } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './Deliverables.module.css'

export type DeliverablesInjected = ProducedFilesInjected & {
  loadFileDiff: LoadFileDiff
  /** Open Status-column Changes tab for this turn (optional in unit tests). */
  openOverviewReview?: (index: number, seq: number) => void
}

export type DeliverablesTailProps =
  PropsRuntime<'conversation.chat.turnTail'>
  & PropsLocale<typeof NS>
  & InjectFace<DeliverablesInjected>

export { selectDeliverables }

export function DeliverablesTail(props: DeliverablesTailProps) {
  const matched = selectDeliverables(props)
  return matched === null ? null : <Deliverables {...props} matched={matched} />
}

function Deliverables({
  matched, openFile, t, loadFileDiff, openOverviewReview, isLoopback, openNativePath, useHostDescription,
}: Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: DeliverablesMatch
} & PropsLocale<typeof NS> & InjectFace<DeliverablesInjected>) {
  const laneProps = {
    openFile,
    t,
    isLoopback,
    openNativePath,
    useHostDescription,
  } as const
  // One flex item for the turn-tail column: card + lanes share 8px, not the
  // outer 16px gap stacked on each lane's former margin-top.
  return (
    <div className={css.stack} data-turn-deliverables>
      {matched.changes !== null && (
        <ChangedFiles
          changes={matched.changes}
          loadFileDiff={loadFileDiff}
          openFile={openFile}
          {...(openOverviewReview
            ? {
              openOverviewReview: (index: number) => {
                openOverviewReview(index, matched.changes!.seq)
              },
            }
            : {})}
          t={t}
        />
      )}
      <ProducedFiles
        matched={matched.lanes.modified}
        label={t('lanes.modified')}
        rowTestId="file-lane-modified"
        {...laneProps}
      />
      <ProducedFiles
        matched={matched.lanes.deleted}
        label={t('lanes.deleted')}
        rowTestId="file-lane-deleted"
        {...laneProps}
      />
      <ProducedFiles
        matched={matched.lanes.created}
        label={t('lanes.created')}
        rowTestId="file-lane-created"
        {...laneProps}
      />
    </div>
  )
}

