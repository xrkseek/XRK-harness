/** Combined turn-tail: changed-files card + produced-files row. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type { TurnTailOwnerProps } from '@xrkseek/client-ui-conversation/client'
import { ChangedFiles, type LoadFileDiff } from './ChangedFiles.tsx'
import { ProducedFiles, type ProducedFilesInjected } from './ProducedFiles.tsx'
import { selectDeliverables, type DeliverablesMatch } from './turn-deliverables.ts'
import type { NS } from './locales.ts'

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
  return <>
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
    {matched.produced.length > 0 && (
      <ProducedFiles
        matched={matched.produced}
        openFile={openFile}
        t={t}
        isLoopback={isLoopback}
        openNativePath={openNativePath}
        useHostDescription={useHostDescription}
      />
    )}
  </>
}
