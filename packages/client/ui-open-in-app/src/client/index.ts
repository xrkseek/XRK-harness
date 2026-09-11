/**
 * Browser half of open-in-app: Session-header split button opening the
 * session workspace directory in a Face-probed application.
 */

import type { ClientContext } from '@xrkseek/client-runtime/client'
import type { ConnectionHandle } from '@xrkseek/client-connection/client'
import type {} from '@xrkseek/client-locale/client'
import type {} from '@xrkseek/client-ui-conversation/client'
import { OpenInAppController } from './controller.ts'
import { OpenInAppAction, type OpenInAppActionInjected } from './OpenInAppAction.tsx'
import { en, NS, zh, type OpenInAppKey } from './locales.ts'

declare module '@xrkseek/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session-header "open workspace in application" copy. */
    'open-in-app': OpenInAppKey
  }
}

export type { OpenInAppActionInjected, OpenInAppActionProps } from './OpenInAppAction.tsx'

/** Required services for locale, Face API, and the header-slot contribution. */
export const inject = ['sessions', 'slots', 'locale', 'connection']

/**
 * Client plugin body: register dictionaries and the header split button.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new OpenInAppController(connection)
  void controller.load()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'open-in-app: dictionaries')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'open-in-app',
    order: -10,
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
