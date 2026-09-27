/**
 * First-party floating workbench: Host `/sidebar/*` file tree + preview.
 * Product cut: in-flow `details` = Status (`ui-plan`); rich explorer/terminal/
 * browser stay on community `xrkh-better-sidebar`. This plugin provides
 * `ctx.workbench` and mounts an overlay that yields when `ctx.betterSidebar`
 * is present so chat file opens fall through to the community wrap of
 * `workspaces.openPath`. The session-header「文件」button stays visible and
 * wakes the community side card.
 */
import type { ClientContext } from '@xrkseek/client-runtime/client'
import type {} from '@xrkseek/client-locale/client'
import type {} from '@xrkseek/client-ui-layout/client'
import type {} from '@xrkseek/client-ui-conversation/client'
import type { ConnectionHandle } from '@xrkseek/client-connection/client'
import {
  openCommunitySidebar,
  type BetterSidebarFace,
} from './community-open.ts'
import { WorkbenchController } from './controller.ts'
import { WorkbenchPanel } from './WorkbenchPanel.tsx'
import { WorkbenchToggle } from './WorkbenchToggle.tsx'
import { en, zh, type WorkbenchKey } from './locales.ts'

export type { WorkbenchKey } from './locales.ts'
export type { WorkbenchFace, WorkbenchFsEntry } from './fs-api.ts'
export type { WorkbenchToggleInjected, WorkbenchToggleProps } from './WorkbenchToggle.tsx'
export { WorkbenchController } from './controller.ts'
export { WorkbenchToggle } from './WorkbenchToggle.tsx'
export {
  isImagePath, isPdfPath, listFsTree, readFsFile, sidebarApi, sidebarFileUrl,
} from './fs-api.ts'
export { openCommunitySidebar } from './community-open.ts'
export type { BetterSidebarFace } from './community-open.ts'

declare module '@xrkseek/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Floating workbench panel copy. */
    workbench: WorkbenchKey
  }
}

declare module '@xrkseek/cordis' {
  interface Context {
    /** First-party (or claimed) workspace workbench face. */
    workbench: import('./fs-api.ts').WorkbenchFace
    /**
     * Present when community `xrkh-better-sidebar` (or equivalent) owns the
     * floating workbench — builtin panel yields; header「文件」still opens it.
     */
    betterSidebar?: BetterSidebarFace
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'workbench'

/** Required services. */
export const inject = ['slots', 'locale', 'layout', 'sessions', 'workspaces', 'connection']

/**
 * Client plugin body: provide workbench face and mount the overlay entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const isYielded = (): boolean => ctx.get('betterSidebar') !== undefined
  const controller = new WorkbenchController(isYielded)
  ctx.effect(() => ctx.reflect.provide('workbench', controller), 'ui-workbench: face')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workbench: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle | undefined

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'builtin-workbench',
    order: 40,
    locale: NS,
    inject: () => {
      const snap = ctx.sessions.list.getSnapshot()
      const current = snap.current
      const cwd = current !== undefined ? snap.byId[current]?.cwd : undefined
      return {
        workbench: controller,
        sessionId: current,
        rootPath: typeof cwd === 'string' && cwd.length > 0 ? cwd : '.',
        yielded: isYielded,
        openInOs: (path: string) => {
          void connection?.api.host.openPath({ path }).catch(() => {
            void ctx.workspaces.openPath(path)
          })
        },
      }
    },
  }, WorkbenchPanel), 'ui-workbench: overlay')

  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'workbench-toggle',
      // After jobs (20): Files is a workspace utility, not process work.
      order: 25,
      locale: NS,
      inject: () => {
        const face = (): BetterSidebarFace | undefined => ctx.get('betterSidebar')
        return {
          workbench: controller,
          yielded: isYielded,
          openCommunity: {
            open: () => { openCommunitySidebar(face()) },
            isOpen: () => face()?.getSnapshot?.()?.state?.panelOpen === true,
            subscribe: (listener) => {
              const sidebar = face()
              if (sidebar?.subscribeState === undefined) return () => {}
              return sidebar.subscribeState(listener)
            },
          },
        }
      },
    }, WorkbenchToggle),
    'ui-workbench: header toggle',
  )
}
