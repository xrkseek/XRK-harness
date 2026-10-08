/**
 * Release notes plugin, browser half: the sidebar-foot `sidebar.footer.action`
 * entry. Owns one piece of durable state — the "newest version this user has
 * opened" marker in Host settings — and no content: the notes are bundle copy
 * (release-notes.ts), so the list can never disagree with the installed build.
 *
 * Read-on-expand, not read-on-load or read-on-dialog: loading the shell or
 * merely opening the list must not consume notes. The dot clears when the user
 * expands the newest version row.
 */
import type { ClientContext } from '@xrkseek/client-runtime/client'
import type { ConnectionHandle } from '@xrkseek/xrk-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type { LocalizedText } from '@xrkseek/client-locale/client'
import type {} from '@xrkseek/client-locale/client'
// Type-only: pulls the ui-sidebar SlotMap merge (the footer.action entry).
import type {} from '@xrkseek/client-ui-sidebar/client'
import { ReleaseNotesButton } from './ReleaseNotesButton.tsx'
import type { ReleaseNotesButtonInjected } from './ReleaseNotesButton.tsx'
import { ReleaseNotesStore } from './release-notes-store.ts'
import { en, zh, type ReleaseNotesKey } from './locales.ts'
import { RELEASE_NOTES_SETTINGS_NAMESPACE } from './release-notes-copy.ts'

export type { ReleaseNotesButtonInjected, ReleaseNotesButtonProps } from './ReleaseNotesButton.tsx'
export type { ReleaseNotesState } from './release-notes-store.ts'
export type { ReleaseNotesKey } from './locales.ts'
export { RELEASE_NOTES, RELEASE_NOTES_PINNED } from './release-notes.ts'
export type { ReleaseNote, ReleaseNotesPinned } from './release-notes.ts'

declare module '@xrkseek/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The sidebar release-notes button and dialog. */
    'release-notes': ReleaseNotesKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'release-notes'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Register the sidebar release-notes action and wire its read marker to the
 * connection. Kept fresh on the same pushed settings invalidations the welcome
 * notice rides, so a second window's read clears this one too.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-release-notes: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new ReleaseNotesStore(
    connection.api,
    connection.isLoopback ? 'host' : 'memory',
  )
  const injected = (): ReleaseNotesButtonInjected => ({
    controller,
    hooks: { releaseNotes: controller.store },
    t: ctx.locale.bind(NS) as ReleaseNotesButtonInjected['t'],
    // Arrow keeps locale as `this` — unbound method throws on `this.snapshot`.
    resolveText: (text: LocalizedText) => ctx.locale.resolveText(text),
  })

  ctx.effect(() => {
    const refresh = (): void => {
      if (controller.store.getSnapshot().status === 'idle') return
      void controller.load()
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns) => {
        if (ns === RELEASE_NOTES_SETTINGS_NAMESPACE) refresh()
      }),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-release-notes: pushed invalidations')

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'release-notes',
    order: 10,
    locale: NS,
    inject: injected,
  }, ReleaseNotesButton))
}