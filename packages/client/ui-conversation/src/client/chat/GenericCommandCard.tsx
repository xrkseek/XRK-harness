// GenericCommandCard: the default slash-command row — distinct from tool
// cards (leading `/`, slash title). Supplied by the chat view as the keyed
// commandview slot's render-site fallback; registrants may compose it as a
// base, feeding the same owner payload through.

import { useState, type ReactNode } from 'react'
import type { ChatViewSlotProps, CommandRowOwnerProps } from '../contract/slots.ts'
import { DisclosureRow, StateDot } from '@xrkseek/client-ui-primitives'
import a11yCss from './accessibility.module.css'
import css from './GenericCommandCard.module.css'

type CommandRowState = 'running' | 'ok' | 'error'

/** Node state → row state semantic (running while unsettled; outcome kind after). */
function stateOf(outcome: CommandRowOwnerProps['node']['outcome']): CommandRowState {
  if (outcome === null) return 'running'
  return outcome.kind === 'error' ? 'error' : 'ok'
}

function leadingFor(state: CommandRowState): ReactNode {
  return state === 'error'
    ? <StateDot state="error" />
    : <span className={css.slashMark} aria-hidden>/</span>
}

/** First line for the collapsed summary; multiline bodies expand by default. */
function summaryLine(text: string): string {
  const line = text.split(/\r?\n/u, 1)[0] ?? text
  return line.trim() === '' ? text : line
}

/** Card props: the owner payload plus the render site's locale seat (plain prop). */
export interface GenericCommandCardProps extends CommandRowOwnerProps {
  t: ChatViewSlotProps['t']
  /** Command-specific running copy; absent uses the generic command label. */
  runningSummary?: string | undefined
}

export function GenericCommandCard({ node, t, runningSummary }: GenericCommandCardProps) {
  const text = node.outcome?.text
  const multiline = text !== undefined && text.includes('\n')
  const [expanded, setExpanded] = useState(multiline)
  const summary = node.outcome === null
    ? runningSummary ?? t('command.running')
    : text === undefined
      ? (node.outcome.kind === 'error' ? t('command.failed') : t('command.done'))
      : summaryLine(text)
  // Title is `/name` so the row reads as a slash command, not a tool call.
  // A cross-window node whose run page fell out of the window has no name.
  const title = node.name === null || node.name === undefined
    ? t('command.title')
    : `/${node.name}`
  const state = stateOf(node.outcome)
  const body = multiline && text !== undefined ? text : null
  const open = expanded && body !== null
  return (
    <div className={css.root} data-variant="command" data-state={state}>
      {state === 'running' && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      {state === 'error' && <span className={a11yCss.visuallyHidden}>{t('row.failed')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={leadingFor(state)}
        title={title}
        open={open}
        expandable={body !== null}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span className={css.summary} data-error={state === 'error' || undefined}>{summary}</span>
          </>
        )}
      >
        <pre className={css.body} data-error={state === 'error' || undefined}>{body}</pre>
      </DisclosureRow>
    </div>
  )
}
