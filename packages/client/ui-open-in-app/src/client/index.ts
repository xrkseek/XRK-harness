/**
 * Browser half of open-in-app: Overview tools strip opening the session
 * workspace directory in a Face-probed application.
 */

import type { ClientContext } from '@xrkseek/client-runtime/client'
import type { ConnectionHandle } from '@xrkseek/client-connection/client'
import type {} from '@xrkseek/client-locale/client'
import type {} from '@xrkseek/client-ui-layout/client'
import { OpenInAppController } from './controller.ts'
import { OpenInAppAction, type OpenInAppActionInjected } from './OpenInAppAction.tsx'
import { en, NS, zh, type OpenInAppKey } from './locales.ts'

declare module '@xrkseek/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Overview "open workspace in application" copy. */
    'open-in-app': OpenInAppKey
  }
}

export type { OpenInAppActionInjected, OpenInAppActionProps } from './OpenInAppAction.tsx'

/** Required services for locale, Face API, and the Overview tools contribution. */
export const inject = ['sessions', 'slots', 'locale', 'connection']

/**
 * Client plugin body: register dictionaries and the Overview split button.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new OpenInAppController(connection)
  // Desktop Host Fetch is not live at plugin apply — sync on connect / describe.
  controller.syncFromConnection()
  ctx.effect(() => {
    const unsubState = connection.connectionState.subscribe(() => {
      controller.syncFromConnection()
    })
    const unsubHost = connection.hostDescription.subscribe(() => {
      controller.syncFromConnection()
    })
    return () => {
      unsubState()
      unsubHost()
    }
  }, 'open-in-app: probe apps after Face connect')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'open-in-app: dictionaries')
  ctx.slots.inject('details.status.utilities', () => ctx.slots.register({
    name: 'details.status.utilities',
    id: 'open-in-app',
    order: 10,
    locale: NS,
    inject: (): OpenInAppActionInjected => ({
      hooks: {
        openInAppApps: controller.apps,
        openInAppChoice: controller.choice,
        hostDescription: connection.hostDescription,
      },
      isLoopback: connection.isLoopback,
      launch: (appId, path) => controller.launch(appId, path),
      choose: (appId) => { controller.choose(appId) },
    }),
  }, OpenInAppAction))
}
