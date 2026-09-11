/**
 * Session feedback dialog + acknowledgement toast in conversation.input.overlay.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Button, IconCheckOutline16, Modal, Toast,
} from '@xrkseek/client-ui-primitives'
import type { FeedbackCategory } from './dialog.ts'
import type { FeedbackDialogProps } from './slots.ts'
import css from './FeedbackDialog.module.css'

const CATEGORY_CHIPS = {
  'task-result': true,
  'instruction-following': true,
  'product-interaction': true,
  'service-stability': true,
  'resource-cost': true,
  'security-privacy-permission': true,
  'other': true,
} satisfies Record<FeedbackCategory, true>
const CATEGORIES = Object.keys(CATEGORY_CHIPS) as FeedbackCategory[]

const FAILURE_COPY: Partial<Record<string, 'error.conflict' | 'error.noteTooLarge'>> = {
  'version-conflict': 'error.conflict',
  'note-too-large': 'error.noteTooLarge',
  'invalid-payload': 'error.noteTooLarge',
}

/**
 * Render one Session's feedback dialog and toast.
 */
export function FeedbackDialog({ useDialog, edit, submit, dismiss, dismissToast, t }: FeedbackDialogProps) {
  const state = useDialog(s => s)
  const probeRef = useRef<HTMLSpanElement>(null)
  const [card, setCard] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    setCard(probeRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null)
  }, [])
  const toast = state.toast
  const onToastDone = useCallback(() => { dismissToast(toast) }, [dismissToast, toast])
  useEffect(() => () => { dismissToast(toast) }, [dismissToast, toast])
  const failure = state.failure === null ? null : t(FAILURE_COPY[state.failure] ?? 'error.generic')

  return (
    <>
      <span ref={probeRef} hidden />
      {toast > 0 && (
        <Toast
          key={toast}
          text={t('toast.recorded')}
          icon={<span className={css.toastIcon}><IconCheckOutline16 size={12} /></span>}
          anchor={card}
          onDone={onToastDone}
        />
      )}
      <Modal
        open={state.target !== null}
        title={t('dialog.title')}
        closeLabel={t('close')}
        onClose={dismiss}
        className={css.dialog as string}
        footer={(
          <Button
            variant="primary"
            className={css.submit}
            disabled={state.submitting}
            onClick={() => { void submit() }}
          >
            {state.submitting ? t('submitting') : t('submit')}
          </Button>
        )}
      >
        <div className={css.categories} role="group" aria-label={t('dialog.categories')}>
          {CATEGORIES.map(category => (
            <button
              key={category}
              type="button"
              className={state.category === category ? `${css.chip} ${css.chipActive}` : css.chip}
              aria-pressed={state.category === category}
              disabled={state.submitting}
              onClick={() => { edit({ category: state.category === category ? null : category }) }}
            >
              {t(`category.${category}`)}
            </button>
          ))}
        </div>
        <textarea
          className={css.detail}
          aria-label={t('dialog.detail')}
          placeholder={t('dialog.hint')}
          value={state.text}
          readOnly={state.submitting}
          onChange={(event) => { edit({ text: event.target.value }) }}
        />
        {failure !== null && <span className={css.failure} role="status">{failure}</span>}
      </Modal>
    </>
  )
}
