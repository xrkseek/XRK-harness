import type { ChatNode } from '../contract/chat-nodes.ts'
import type {
  ChatLocationNodeIndex, ChatNodeStore, TurnNavigationItem,
} from '@xrkseek/client-runtime/client'

/**
 * Preview budget per field. The rail clamps two short lines, so anything past
 * this is invisible; copying whole transcripts into navigation state would
 * otherwise grow with the loaded window on every structural update.
 */
const PREVIEW_LIMIT = 160

/** Join rendered text until the preview budget is met, then stop reading. */
function preview(parts: Iterable<string>): string {
  let text = ''
  for (const part of parts) {
    text += text === '' ? part : ` ${part}`
    if (text.length >= PREVIEW_LIMIT) break
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LIMIT)
}

function promptText(node: ChatNode): string {
  if (node.kind !== 'user') return ''
  return preview(node.data.content.flatMap(block => (
    'type' in block && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
  )))
}

function responseText(node: ChatNode): string {
  if (node.kind !== 'assistant-step') return ''
  return preview(node.data.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []))
}

/**
 * Whether two items carry the same rail state, so the reader can keep its array.
 * @param left - previously published item, when the Turn had one.
 * @param right - freshly derived item, when the Turn still has one.
 * @returns whether both sides describe the same mark.
 */
export function sameTurnNavigationItem(
  left: TurnNavigationItem | undefined,
  right: TurnNavigationItem | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.turn === right.turn && left.anchorKey === right.anchorKey
    && left.prompt === right.prompt && left.response === right.response
}

/**
 * Project one loaded Host turn into a 轮次 rail item.
 *
 * 轮次 is not Host `turn`. A 轮次 exists only when this turn has an opening
 * `user` message. 插话 (`steering`) never opens a 轮次, even if it is the
 * only human row in that Host turn.
 */
export function turnNavigationItem(
  turn: number,
  locations: ChatLocationNodeIndex,
  nodes: ChatNodeStore,
): TurnNavigationItem | undefined {
  const loaded = locations.getTurn(turn)
    .map(key => nodes.get(key))
    .filter((node): node is ChatNode => node !== undefined && node.visibility === 'visible')
  const user = loaded.find(node => node.kind === 'user')
  if (user === undefined) return undefined
  const response = loaded.findLast(node => responseText(node) !== '')
  return {
    turn,
    anchorKey: user.key,
    prompt: promptText(user),
    response: response === undefined ? '' : responseText(response),
  }
}
