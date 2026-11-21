/**
 * Hand-written controls for the plugin configuration forms. Each renders one
 * field's label, its staged text, whether saving would leave an override, and
 * — when one stands — the reset that stages a clear back to the composition
 * layer. Nothing here writes: a control reports what the user typed, and the
 * card's save is the single point where a draft becomes a document mutation.
 *
 * Choice controls use the portaled {@link Menu} instead of a native `<select>`:
 * Settings panels keep `overflow: hidden` + enter transforms, which break the
 * Android WebView / embedded-browser native picker (tap shows no options).
 */

import { useMemo, useState } from 'react'
import { IconChevronDownOutlineRegular, Menu } from '@xrkseek/client-ui-primitives'
import css from './fields.module.css'

/** What every field control needs regardless of its value type. */
export interface FieldProps {
  /** Stable id associating the label with its control. */
  id: string
  /** Visible label. */
  label: string
  /** One-line explanation rendered under the control. */
  hint: string
  /** Draft text this control renders. */
  text: string
  /** True when saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** True when the draft is not a value this field accepts. */
  invalid: boolean
  /** Copy for the overridden badge. */
  overriddenLabel: string
  /** Copy for the reset control. */
  resetLabel: string
  /** Copy shown in place of the hint while the draft is invalid. */
  invalidLabel: string
  /** Disables every control (read-only document, or an unavailable namespace). */
  disabled: boolean
  /** Stage draft text. */
  onEdit: (text: string) => void
  /** Stage a clear so the field re-inherits the composition layer. */
  onReset: () => void
}

type SelectOption = { readonly value: string; readonly label: string }

/**
 * Label + control + hint without override chrome (list editors, MCP rows).
 */
export function PlainField(props: {
  id: string
  label: string
  hint: string
  value: string
  disabled: boolean
  invalid?: boolean
  placeholder?: string
  onChange: (value: string) => void
}) {
  const invalid = props.invalid === true
  return (
    <div className={css.field}>
      <label className={css.label} htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        className={invalid ? `${css.input} ${css.inputInvalid}` : css.input}
        type="text"
        value={props.value}
        placeholder={props.placeholder ?? ''}
        disabled={props.disabled}
        aria-invalid={invalid || undefined}
        onChange={(event) => { props.onChange(event.target.value) }}
      />
      <p className={css.hint}>{props.hint}</p>
    </div>
  )
}

/** Portaled menu picker — same closed chrome as the old native select. */
function MenuSelectControl(props: {
  id: string
  label: string
  value: string
  disabled: boolean
  invalid?: boolean
  options: readonly SelectOption[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = useMemo(
    () => props.options.find((option) => option.value === props.value),
    [props.options, props.value],
  )
  const items = useMemo(
    () => props.options.map((option) => ({ id: option.value, label: option.label })),
    [props.options],
  )
  const display = selected?.label ?? props.value
  return (
    <Menu
      open={open && !props.disabled}
      onClose={() => { setOpen(false) }}
      items={items}
      selectedId={props.value}
      portal
      align="start"
      onSelect={(id) => {
        setOpen(false)
        if (id !== props.value) props.onChange(id)
      }}
      anchor={(
        <button
          type="button"
          id={props.id}
          className={
            props.invalid === true
              ? `${css.input} ${css.select} ${css.selectTrigger} ${css.inputInvalid}`
              : `${css.input} ${css.select} ${css.selectTrigger}`
          }
          disabled={props.disabled}
          aria-haspopup="listbox"
          aria-expanded={open && !props.disabled}
          aria-label={props.label}
          aria-invalid={props.invalid === true || undefined}
          onClick={() => {
            if (!props.disabled) setOpen((next) => !next)
          }}
        >
          <span className={css.selectValue}>{display}</span>
          <IconChevronDownOutlineRegular className={css.selectChevron} size={12} aria-hidden="true" />
        </button>
      )}
    />
  )
}

/** Same chrome as PlainField, for a short option list (MCP transport / sandbox). */
export function SelectField(props: {
  id: string
  label: string
  hint: string
  value: string
  disabled: boolean
  options: readonly SelectOption[]
  onChange: (value: string) => void
}) {
  const hint = props.hint.trim()
  return (
    <div className={css.field}>
      <label className={css.label} htmlFor={props.id}>{props.label}</label>
      <MenuSelectControl
        id={props.id}
        label={props.label}
        value={props.value}
        disabled={props.disabled}
        options={props.options}
        onChange={props.onChange}
      />
      {hint.length > 0 ? <p className={css.hint}>{hint}</p> : null}
    </div>
  )
}

/**
 * A staged value field. `numeric` only hints the keypad: which drafts a field
 * accepts is decided by its spec, so the control never silently rewrites what
 * the user typed.
 * @param props - the field's copy, its staged text, and the edit actions.
 * @returns the labelled control.
 */
export function ValueField(props: FieldProps & {
  /** Hints a numeric keypad without narrowing what the control accepts. */
  numeric?: boolean
  /** Placeholder shown while the draft is empty. */
  placeholder?: string
}) {
  return (
    <div className={css.field}>
      <div className={css.head}>
        <label className={css.label} htmlFor={props.id}>{props.label}</label>
        {props.overridden
          ? (
            <span className={css.badges}>
              <span className={css.badge}>{props.overriddenLabel}</span>
              <button
                type="button"
                className={css.reset}
                disabled={props.disabled}
                onClick={props.onReset}
              >
                {props.resetLabel}
              </button>
            </span>
          )
          : null}
      </div>
      <input
        id={props.id}
        className={props.invalid ? `${css.input} ${css.inputInvalid}` : css.input}
        type="text"
        {...props.numeric === true ? { inputMode: 'numeric' as const } : {}}
        {...props.invalid ? { 'aria-invalid': true } : {}}
        value={props.text}
        placeholder={props.placeholder ?? ''}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className={props.invalid ? css.invalid : css.hint}>
        {props.invalid ? props.invalidLabel : props.hint}
      </p>
    </div>
  )
}

/**
 * A staged choice field with the same override/reset chrome as ValueField.
 * @param props - the field's copy, its staged text, the options, and the edit actions.
 * @returns the labelled control.
 */
export function ChoiceField(props: FieldProps & {
  options: readonly SelectOption[]
}) {
  return (
    <div className={css.field}>
      <div className={css.head}>
        <label className={css.label} htmlFor={props.id}>{props.label}</label>
        {props.overridden
          ? (
            <span className={css.badges}>
              <span className={css.badge}>{props.overriddenLabel}</span>
              <button
                type="button"
                className={css.reset}
                disabled={props.disabled}
                onClick={props.onReset}
              >
                {props.resetLabel}
              </button>
            </span>
          )
          : null}
      </div>
      <MenuSelectControl
        id={props.id}
        label={props.label}
        value={props.text}
        disabled={props.disabled}
        invalid={props.invalid}
        options={props.options}
        onChange={props.onEdit}
      />
      <p className={props.invalid ? css.invalid : css.hint}>
        {props.invalid ? props.invalidLabel : props.hint}
      </p>
    </div>
  )
}

/**
 * A write-only credential control. The value never rides a response, so the
 * control reports only whether one is configured and starts blank; a blank
 * draft writes nothing, which keeps the stored key rather than clearing it.
 * @param props - the field's copy, its staged text, and the configured state.
 * @returns the labelled control.
 */
export function SecretField(props: Pick<FieldProps, 'id' | 'label' | 'hint' | 'text' | 'disabled' | 'onEdit'> & {
  /** Whether the Host reports a configured credential for this reference. */
  configured: boolean
  /** Copy describing the configured state. */
  stateLabel: string
}) {
  return (
    <div className={css.field}>
      <div className={css.head}>
        <label className={css.label} htmlFor={props.id}>{props.label}</label>
        <span className={css.badges}>
          <span className={props.configured ? css.badge : css.badgeMuted}>{props.stateLabel}</span>
        </span>
      </div>
      <input
        id={props.id}
        className={css.input}
        type="password"
        autoComplete="off"
        value={props.text}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className={css.hint}>{props.hint}</p>
    </div>
  )
}
