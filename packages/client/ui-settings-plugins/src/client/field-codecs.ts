/**
 * Draft codecs for the plugin card fields. Kept free of client-runtime
 * imports so Node vitest can exercise them (same convention as
 * tool-order-draft.ts).
 */

/** The write one field's staged text performs when the card is saved. */
export type FieldWrite =
  | { kind: 'set'; value: unknown }
  | { kind: 'clear' }

/** How one section field converts between its stored value and its draft text. */
export interface CardFieldSpec {
  /** Field name inside the namespace section. */
  field: string
  /** Render a stored value as draft text; the empty string when the section carries none. */
  format: (value: unknown) => string
  /**
   * The write this draft text stages, or undefined when the text is not a
   * value this field accepts — which blocks the save rather than discarding it.
   */
  parse: (text: string) => FieldWrite | undefined
}

/**
 * A whole-number field. An empty draft clears the field; any other draft that
 * is not a finite number blocks the save.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function numberField(field: string): CardFieldSpec {
  return {
    field,
    // A section that carries no number for this field renders empty rather
    // than as a value nobody chose.
    format: value => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
    },
  }
}

/**
 * An on/off field. A missing value renders as the off state. Both poles stage
 * an explicit set: turning a switch off must write `false`, never silently
 * clear back to the composition layer.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function booleanField(field: string): CardFieldSpec {
  return {
    field,
    format: value => value === true ? 'true' : 'false',
    parse: (text) => {
      if (text === 'true') return { kind: 'set', value: true }
      if (text === 'false') return { kind: 'set', value: false }
      return undefined
    },
  }
}

/**
 * A free-text field. An empty draft clears the field, so emptying the control
 * and saving is the same gesture as resetting it.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function textField(field: string): CardFieldSpec {
  return {
    field,
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}
