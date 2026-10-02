/** Root/subcall Tool composition with one keyed atomic dispatch path. */
import { memo, useMemo, type ReactNode } from 'react'
import type { ToolCallBlock } from '@xrkseek/client-runtime/client'
import type { ToolCallOwnerProps, ToolTreeProps } from '../contract/slots.ts'
import { toolRowModel } from './models/tool-call-model.ts'
import { ToolDefaultExpandedContext } from './tool-default-expanded.ts'
import { GenericToolCard } from './toolviews/GenericToolCard.tsx'
import css from './ToolCallTree.module.css'

/** Resolve a Tool call's wire name from either lifecycle form. */
function callName(node: ToolCallBlock): string {
  return 'kind' in node ? node.call?.name ?? '' : node.name
}

/** One atomic call dispatched through the Tool-owned keyed slot. */
const ToolCall = memo(function ToolCall({
  renderSlot, callId, toolName, block, openFile, loadImage, selected, cwd, home, inspectCall, t, children,
}: Pick<ToolTreeProps, 'renderSlot' | 'openFile' | 'cwd' | 'inspectCall' | 't'> & {
  callId: string
  toolName: string
  block: ToolCallBlock
  selected: boolean
  home?: string | undefined
  loadImage?: ToolCallOwnerProps['loadImage']
  children?: ReactNode
}) {
  const owner: ToolCallOwnerProps = useMemo(() => ({
    callId,
    toolName,
    block,
    openFile,
    cwd,
    home,
    ...(loadImage === undefined ? {} : { loadImage }),
    inspect: () => { inspectCall(callId) },
  }), [callId, toolName, block, openFile, cwd, home, loadImage, inspectCall])
  // DSH: final AutoReviewDeniedError always uses GenericToolCard — skip keyed
  // toolviews (bash/read/…) so the localized denial identity is not replaced.
  const autoReviewDenied = useMemo(
    () => toolRowModel(toolName, block).autoReviewDenial !== null,
    [toolName, block],
  )
  return (
    <div
      className={css.callRow}
      data-chat-anchor-key={`call:${callId}`}
      data-chat-call-id={callId}
      data-selected={selected || undefined}
    >
      {autoReviewDenied
        ? <GenericToolCard {...owner} t={t} renderSlot={renderSlot} />
        : renderSlot('tool.call.toolview', owner, {
          entryKey: toolName,
          // Tree-authorized images/files slots reach the keyed-miss fallback.
          fallback: <GenericToolCard {...owner} t={t} renderSlot={renderSlot} />,
        })}
      {children}
    </div>
  )
})

const ToolCallBranch = memo(function ToolCallBranch({
  renderSlot, block, selectedCallId, cwd, home, openFile, loadImage, inspectCall, t,
}: Pick<ToolTreeProps, 'renderSlot' | 'selectedCallId' | 'cwd' | 'openFile' | 'inspectCall' | 't'> & {
  block: ToolCallBlock
  home?: string | undefined
  loadImage?: ToolCallOwnerProps['loadImage']
}) {
  return (
    <ToolCall
      renderSlot={renderSlot}
      callId={block.callId}
      toolName={callName(block)}
      block={block}
      openFile={openFile}
      loadImage={loadImage}
      selected={block.callId === selectedCallId}
      cwd={cwd}
      home={home}
      inspectCall={inspectCall}
      t={t}
    >
      {block.subCalls.length > 0 ? (
        <div className={css.subCalls} data-subcalls>
          {block.subCalls.map(child => (
            <ToolCallBranch
              key={child.callId}
              renderSlot={renderSlot}
              block={child}
              selectedCallId={selectedCallId}
              cwd={cwd}
              home={home}
              openFile={openFile}
              loadImage={loadImage}
              inspectCall={inspectCall}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </ToolCall>
  )
})

/**
 * Render one root Tool call and its recursive children through the same
 * atomic keyed dispatch.
 * @param props - whole-Tool owner data and the Tool-owned child-slot share.
 * @returns the Tool call tree.
 */
export function ToolCallTree({
  renderSlot, node, selectedCallId, cwd, openFile, loadImage, inspectCall, useHostDescription, useToolsDefaultExpanded, t,
}: ToolTreeProps) {
  const home = useHostDescription(info => info?.home)
  const toolsDefaultExpanded = useToolsDefaultExpanded
    ? useToolsDefaultExpanded(value => value)
    : false
  const block = node.data.root
  return (
    <ToolDefaultExpandedContext.Provider value={toolsDefaultExpanded}>
      <ToolCallBranch
        renderSlot={renderSlot}
        block={block}
        selectedCallId={selectedCallId}
        cwd={cwd}
        home={home}
        openFile={openFile}
        loadImage={loadImage}
        inspectCall={inspectCall}
        t={t}
      />
    </ToolDefaultExpandedContext.Provider>
  )
}
