// Present toolview: keyed hole for `present`. Reuses ToolRow chrome + the
// shared write-family path summary from toolRowModel; adds a visible
// delivering/delivered status suffix (DSH PresentRow collapsed state copy)
// without a separate preparing phase (XRK has no ToolCallViewProps.phase).

import type { Context } from '@xrkseek/cordis'
import { IconBrowseOutline16 } from '@xrkseek/client-ui-primitives'
import type { PropsLocale } from '@xrkseek/client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Full row props: the toolview runtime share plus the standard locale seat. */
type PresentRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/**
 * Status label beside the path summary while collapsed (DSH PresentRow
 * "Delivering" / "Delivered"; failure/stop keep ToolRow's own suffix).
 */
function presentSuffix(
  state: ReturnType<typeof toolRowModel>['state'],
  t: PresentRowProps['t'],
): string | null {
  if (state === 'running') return t('present.delivering')
  if (state === 'ok') return t('present.delivered')
  return null
}

/**
 * Present row: icon + Present · {paths} with delivering/delivered suffix.
 */
export function PresentRow({ toolName, block, cwd, home, openFile, inspect, t }: PresentRowProps) {
  const model = toolRowModel(toolName, block, cwd, home)
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={<IconBrowseOutline16 size={14} />}
      title={model.title}
      summary={model.summary}
      summarySuffix={presentSuffix(model.state, t)}
      body={model.body}
      output={model.output}
      errorSummary={model.errorSummary}
      state={model.state}
      filePath={model.filePath}
      onOpenFile={openFile}
      inspect={inspect}
    />
  )
}

/**
 * Present row registrant: keyed toolview under `present`.
 */
export const presentToolview = {
  name: 'present-toolview',
  inject: ['slots'],
  /**
   * Register the present row into the Tool-owned keyed view slot.
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({ name: 'tool.call.toolview', key: 'present', locale: NS }, PresentRow))
  },
}
