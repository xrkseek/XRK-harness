/**
 * Soft-detach wait_agent / peer / foreground subagent — one 「停止等待」 button.
 * Ends the wait only (job.background posture); children / peers keep running.
 * Hard Stop / session.cancel aborts the turn — this dock must never imply that.
 *
 * Visibility follows `host/session-wait-yield` (ConversationSnapshot.waitYield),
 * not tool-name heuristics — Stop's optimistic running:false must not clear it.
 */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type { ClientContext, SessionId } from '@xrkseek/client-runtime/client'
import { NS } from '../locales.ts'
import css from './WaitYieldDock.module.css'

export type WaitYieldDockInjected = {
  yieldWait(): void | Promise<void>
}

export type WaitYieldDockProps =
  PropsRuntime<'conversation.input.dock'>
  & WaitYieldDockInjected
  & PropsLocale<'conversation'>

export function WaitYieldDock({ useSession, yieldWait, t }: WaitYieldDockProps) {
  const waiting = useSession((s) => s.waitYield !== null)
  const [busy, setBusy] = useState(false)
  if (!waiting) return null

  return (
    <div className={css.root} data-testid="wait-yield-dock">
      <button
        type="button"
        className={css.detach}
        disabled={busy}
        title={t('wait.dock.hint')}
        onClick={() => {
          if (busy) return
          setBusy(true)
          void Promise.resolve(yieldWait()).finally(() => setBusy(false))
        }}
      >
        {t('wait.dock.detach')}
      </button>
    </div>
  )
}

export const waitYieldDockEntry = {
  name: 'conversation-wait-yield-dock',
  inject: ['slots', 'sessions'],
  apply(ctx: ClientContext): void {
    const sessions = ctx.sessions
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.dock',
          id: 'wait-yield',
          order: 4,
          locale: NS,
          inject: (sessionId: SessionId): WaitYieldDockInjected => ({
            async yieldWait() {
              const session = sessions.binding(sessionId)?.session
              if (!session) return
              await session.yieldWait()
            },
          }),
        },
        WaitYieldDock,
      ))
  },
}
