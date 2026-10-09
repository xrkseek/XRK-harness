/**
 * PastedTextNode: one over-long paste as an atomic Lexical decorator.
 *
 * Same posture as ReferenceChipNode — the node IS the occurrence, and
 * `getTextContent()` answers the full text so the clipboard/persistence
 * projection stays plain text (the store persists `clipboardText`, never the
 * node tree, so refresh and session switches survive the fold for free).
 *
 * The detect projection counts it as one U+FFFC, exactly like a chip, so
 * trigger scanning and TokenSpan coordinates never see the body.
 *
 * Why: a pasted wall of text inside contenteditable costs Chromium one
 * layout/paint per character, and it costs it again on every keystroke
 * (the caret rect forces a re-layout of the whole block). Measured on the
 * pure-JS side this is invisible (`paste` 33k chars = 1.1ms), so the fold
 * is not an optimization of our scanning — it is the only way to keep the
 * engine's layout out of the draft. Ceiling: the folded body still lives in
 * the editor state (one string field per node), so a draft made of a
 * million pathological pastes would still weigh memory; splitting to disk
 * is the upgrade path.
 */
import type { JSX } from 'react'
import type {
  EditorConfig, LexicalNode, NodeKey, ParagraphNode, SerializedLexicalNode,
  Spread, TextNode,
} from 'lexical'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getEditor,
  $getNodeByKey,
  $isElementNode,
  DecoratorNode,
} from 'lexical'
import { PastedText } from './PastedText.tsx'

/** JSON form of one folded paste (Lexical node serialization contract). */
export type SerializedPastedTextNode = Spread<{
  text: string
  lines: number
}, SerializedLexicalNode>

/** One over-long paste as an atomic decorator holding its full text. */
export class PastedTextNode extends DecoratorNode<JSX.Element> {
  /** Full pasted body — never rendered, only projected. */
  __text: string
  /** Line count for the summary label (counted at insert time). */
  __lines: number

  /** Lexical node registry type tag. */
  static override getType(): string {
    return 'pasted-text'
  }

  /**
   * Clone with identity (Lexical writable-copy contract).
   * @param node - node to clone.
   * @returns a copy carrying the same NodeKey.
   */
  static override clone(node: PastedTextNode): PastedTextNode {
    return new PastedTextNode(node.__text, node.__lines, node.__key)
  }

  /**
   * Rebuild one folded paste from its JSON form.
   * @param json - serialized node.
   * @returns a fresh node.
   */
  static override importJSON(json: SerializedPastedTextNode): PastedTextNode {
    return new PastedTextNode(json.text, json.lines)
  }

  /**
   * @param text - the full pasted body.
   * @param lines - its line count.
   * @param key - Lexical clone-path key; absent for fresh nodes.
   */
  constructor(text: string, lines: number, key?: NodeKey) {
    super(key)
    this.__text = text
    this.__lines = lines
  }

  /** Serialize to the JSON node form. */
  override exportJSON(): SerializedPastedTextNode {
    return {
      ...super.exportJSON(),
      type: 'pasted-text',
      version: 1,
      text: this.__text,
      lines: this.__lines,
    }
  }

  /**
   * Mount the host element; the decorator portal renders into it.
   * @returns an inline, non-editable span carrying the test anchor.
   */
  override createDOM(_config: EditorConfig): HTMLElement {
    const el = document.createElement('span')
    el.setAttribute('data-composer-pasted', '')
    el.setAttribute('contenteditable', 'false')
    return el
  }

  /** Host element never changes shape. */
  override updateDOM(): boolean {
    return false
  }

  /** Sits in the text line. */
  override isInline(): boolean {
    return true
  }

  /**
   * Same reason as ReferenceChipNode: a NodeSelection between the keystroke
   * and the caret deadlocks the plain-text binding's delete/typing handlers
   * at the node edge.
   */
  override isKeyboardSelectable(): boolean {
    return false
  }

  /** Clipboard / persistence projection — the full body, unfolded. */
  override getTextContent(): string {
    return this.__text
  }

  /** The full pasted body. */
  getText(): string {
    return this.getLatest().__text
  }

  /** Line count shown in the summary label. */
  getLines(): number {
    return this.getLatest().__lines
  }

  /**
   * Inline the full body: the decorator leaves the document and ordinary
   * text nodes take its place. This is the escape hatch for the rare case
   * where the user wants to actually edit inside the pasted block — the
   * ceiling noted in the module doc.
   */
  expand(): void {
    // Not $insertNodes: a decorator click in an unfocused draft has no
    // selection. Prefer replacing a sole-child paragraph (setDraft path)
    // with real paragraphs; otherwise splice inline text + line breaks.
    const lines = this.getText().replace(/\r\n?/g, '\n').split('\n')
    const parent = this.getParent()
    let tail: ParagraphNode | TextNode | null = null
    if (
      parent !== null
      && $isElementNode(parent)
      && parent.getChildrenSize() === 1
      && parent.getParent() !== null
    ) {
      for (const line of lines) {
        const paragraph = $createParagraphNode()
        if (line !== '') paragraph.append($createTextNode(line))
        parent.insertBefore(paragraph)
        tail = paragraph
      }
      parent.remove()
      // Land the caret after the body: an expansion the user cannot type
      // into reads as a dead end.
      tail?.selectEnd()
      return
    }
    for (let i = 0; i < lines.length; i += 1) {
      const text = $createTextNode(lines[i]!)
      this.insertBefore(text)
      tail = text
      if (i < lines.length - 1) this.insertBefore($createLineBreakNode())
    }
    this.remove()
    tail?.selectEnd()
  }

  /**
   * Drop the fold and its body from the document (the delete gesture).
   */
  discard(): void {
    const parent = this.getParent()
    this.remove()
    // setDraft wraps each fold in its own paragraph — drop the empty shell
    // so delete does not leave a blank block that still projects a newline.
    if (
      parent !== null
      && $isElementNode(parent)
      && parent.getChildrenSize() === 0
      && parent.getParent() !== null
    ) {
      parent.remove()
    }
  }

  /** React face rendered into the host element by the decorator portal. */
  override decorate(): JSX.Element {
    // Capture the editor while decorate() still runs inside an active update.
    const editor = $getEditor()
    const key = this.getKey()
    return (
      <PastedText
        lines={this.__lines}
        chars={this.__text.length}
        preview={firstMeaningfulLine(this.__text)}
        onExpand={() => {
          editor.update(() => {
            const node = $getNodeByKey(key)
            if ($isPastedTextNode(node)) node.expand()
          }, { discrete: true })
        }}
        onDelete={() => {
          editor.update(() => {
            const node = $getNodeByKey(key)
            if ($isPastedTextNode(node)) node.discard()
          }, { discrete: true })
        }}
      />
    )
  }
}

/**
 * Mint one folded paste node.
 * @param text - the full pasted body.
 * @returns the fresh node.
 */
export function $createPastedTextNode(text: string): PastedTextNode {
  return new PastedTextNode(text, countLines(text))
}

/** Line count for the summary label (`\r\n` collapsed first). */
export function countLines(text: string): number {
  return text.replace(/\r\n?/g, '\n').split('\n').length
}

/**
 * The fold's one-line preview: the first line with real content. A paste
 * that opens with blank lines would otherwise preview as nothing, which is
 * exactly the "black box" the preview exists to remove. Absent when the body
 * holds no non-whitespace character at all.
 * @param text - the full pasted body.
 * @returns the preview line, or undefined for a blank body.
 */
export function firstMeaningfulLine(text: string): string | undefined {
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim()
    if (trimmed !== '') return trimmed
  }
  return undefined
}

/**
 * Folded-paste type guard.
 * @param node - any node or nullish.
 * @returns whether it is a PastedTextNode.
 */
export function $isPastedTextNode(node: LexicalNode | null | undefined): node is PastedTextNode {
  return node instanceof PastedTextNode
}