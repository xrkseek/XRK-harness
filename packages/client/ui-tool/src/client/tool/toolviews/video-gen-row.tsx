// video_generate toolview: status summary + cleaned text (no in-chat player).

import type { Context } from '@xrkseek/cordis'
import { IconBrowseOutline16 } from '@xrkseek/client-ui-primitives'
import type { PropsLocale } from '@xrkseek/client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import {
  truncateGenSummary,
  videoGenResultModel,
} from '../models/video-gen-card-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

type VideoGenRowProps = ToolCallViewProps & PropsLocale<'conversation'>

function argsSummary(argsRaw: string): string | undefined {
  try {
    const args = JSON.parse(argsRaw) as Record<string, unknown>
    const action = typeof args.action === 'string' ? args.action : undefined
    const prompt = typeof args.prompt === 'string' ? args.prompt : undefined
    const jobId = typeof args.job_id === 'string' ? args.job_id : undefined
    if (prompt && prompt.trim() !== '') {
      const head = action ? `${action} · ` : ''
      return truncateGenSummary(`${head}${prompt}`)
    }
    if (jobId) return action ? `${action} · ${jobId}` : jobId
    if (action) return action
  } catch {
    /* mid-stream */
  }
  return undefined
}

/** video_generate row: status-aware summary and cleaned job/file output. */
export function VideoGenRow({
  toolName, block, cwd, home, openFile, inspect, t,
}: VideoGenRowProps) {
  const model = toolRowModel(toolName, block, cwd, home)
  const parsed = videoGenResultModel(block)
  const argsRaw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? ''
  const fromArgs = argsSummary(argsRaw)
  const summary = model.state === 'error' && model.errorSummary
    ? model.errorSummary
    : (parsed?.statusSummary ?? fromArgs ?? model.summary)
  const output = parsed?.displayText
    ? parsed.displayText
    : model.output
  return (
    <ToolRow
      t={t}
      variant="others"
      toolName={toolName}
      icon={<IconBrowseOutline16 size={14} />}
      title="Video generation"
      summary={summary}
      body={null}
      output={output}
      errorSummary={model.errorSummary}
      state={model.state}
      filePath={model.filePath}
      onOpenFile={openFile}
      inspect={inspect}
    />
  )
}

/** The video_generate row as a plain registrant plugin. */
export const videoGenToolview = {
  name: 'video-gen-toolview',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'video_generate',
        locale: NS,
      }, VideoGenRow))
  },
}
