/**
 * Claude Code mods AbovePrompt band: draws the serialized Box/Text/Button
 * tree from `bandBySession` and forwards button presses through the session.
 */

import type { BandNode, BandSnapshot, ClientContext, SessionId } from '@xrkseek/client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type { CSSProperties, ReactNode } from 'react'
import { NS } from '../locales.ts'
import css from './ModBandDock.module.css'

export interface ModBandInjected {
  pressBand(generation: number, actionId: string): void
}

export type ModBandDockProps =
  PropsRuntime<'conversation.input.dock'> & ModBandInjected & PropsLocale<'conversation'>

function gapStyle(gap: unknown): CSSProperties | undefined {
  return typeof gap === 'number' ? { gap: `${gap * 4}px` } : undefined
}

function padStyle(props: Readonly<Record<string, string | number | boolean>>): CSSProperties | undefined {
  const padding = typeof props.padding === 'number' ? props.padding : undefined
  const paddingX = typeof props.paddingX === 'number' ? props.paddingX : padding
  const paddingY = typeof props.paddingY === 'number' ? props.paddingY : padding
  if (paddingX === undefined && paddingY === undefined) return undefined
  return {
    ...(paddingY === undefined ? {} : { paddingBlock: `${paddingY * 4}px` }),
    ...(paddingX === undefined ? {} : { paddingInline: `${paddingX * 4}px` }),
  }
}

function renderNodes(
  nodes: readonly BandNode[],
  generation: number,
  pressBand: (generation: number, actionId: string) => void,
): ReactNode {
  return nodes.map((node, index) => {
    if (typeof node === 'string') {
      return <span key={`t${index}`}>{node}</span>
    }
    if (node.type === 'Button') {
      const label = String(node.props.label ?? '')
      const hotkey = typeof node.props.hotkey === 'string' ? node.props.hotkey : undefined
      const disabled = node.props.disabled === true || node.actionId === undefined
      return (
        <button
          key={`b${index}-${node.actionId ?? label}`}
          type="button"
          className={css.button}
          disabled={disabled}
          onClick={() => {
            if (node.actionId !== undefined) pressBand(generation, node.actionId)
          }}
        >
          <span>{label}</span>
          {hotkey !== undefined ? <span className={css.hotkey}>{hotkey}</span> : null}
        </button>
      )
    }
    const direction = node.props.flexDirection === 'row' ? 'row' : 'column'
    const bordered = node.props.border === true || typeof node.props.border === 'string'
    const style: CSSProperties = {
      ...gapStyle(node.props.gap),
      ...padStyle(node.props),
      ...(typeof node.props.borderColor === 'string'
        ? { borderColor: node.props.borderColor }
        : {}),
      ...(typeof node.props.color === 'string' && node.type === 'Text'
        ? { color: node.props.color }
        : {}),
    }
    if (node.type === 'Text') {
      return (
        <span
          key={`x${index}`}
          className={css.text}
          data-bold={node.props.bold === true ? 'true' : undefined}
          data-dim={node.props.dimColor === true ? 'true' : undefined}
          data-italic={node.props.italic === true ? 'true' : undefined}
          data-underline={node.props.underline === true ? 'true' : undefined}
          style={style}
        >
          {renderNodes(node.children, generation, pressBand)}
        </span>
      )
    }
    return (
      <div
        key={`o${index}`}
        className={css.box}
        data-direction={direction}
        data-border={bordered ? 'true' : undefined}
        style={style}
      >
        {renderNodes(node.children, generation, pressBand)}
      </div>
    )
  })
}

/**
 * Input-zone strip for the live mods AbovePrompt band. Renders nothing when
 * the session has no drawn tree.
 */
export function ModBandDock({
  sessionId,
  useSessions,
  pressBand,
  t,
}: ModBandDockProps) {
  const band = useSessions(
    (state): BandSnapshot | undefined => state.bandBySession[sessionId],
  )
  if (band === undefined || band.tree === null || band.tree.length === 0) return null
  return (
    <section className={css.root} data-testid="mod-band-dock" aria-label={t('band.aria')}>
      <div className={css.body}>
        {renderNodes(band.tree, band.generation, pressBand)}
      </div>
    </section>
  )
}

/** Registrant: mounts the band dock above Todo / Goal / Job strips. */
export const modBandDockEntry = {
  name: 'conversation-mod-band-dock',
  inject: ['slots', 'sessions'] as const,
  apply(ctx: ClientContext): void {
    const sessions = ctx.sessions
    const inject = (ownerSessionId: SessionId): ModBandInjected => ({
      pressBand(generation, actionId) {
        void sessions.binding(ownerSessionId)?.session.pressBand(generation, actionId)
      },
    })
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.dock',
          id: 'mod-band',
          // Before Todo (0): plugin chrome sits closest to the transcript.
          order: -10,
          locale: NS,
          inject,
        },
        ModBandDock,
      ))
  },
}
