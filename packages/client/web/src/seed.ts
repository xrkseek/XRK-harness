/**
 * Platform-singleton module-table. These are the ONLY entities the shell
 * shares into the frozen module table — fetch bundles resolve their externals
 * against exactly this set through the loader's require. Keys come from the
 * platform constant module ({@link ./platform.ts}, the single source
 * of truth with the tsdown client externals); values stay shell-static
 * imports so every bundle sees the same instance.
 */
import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import * as ReactDomClient from 'react-dom/client'
import * as Cordis from '@xrkseek/cordis'
import * as UiSlots from '@xrkseek/client-ui-slots'
import * as WebReact from '@xrkseek/client-web-react'
import * as UiPrimitives from '@xrkseek/client-ui-primitives'
import * as UiAttachment from '@xrkseek/client-ui-attachment'
import * as SchemaForm from '@xrkseek/client-schema-form'
import type { PlatformModule } from './platform.ts'

/**
 * Build the static table handed to the module loader at boot.
 * @returns module specifier → exported entity (one entry per platform word).
 */
export function getStaticModules(): Record<string, unknown> {
  // The satisfies pin is the projection contract: a word added to
  // PLATFORM_MODULES without a static import here (or vice versa) fails to
  // compile instead of drifting into a runtime require miss.
  return {
    'react': React,
    'react/jsx-runtime': ReactJsxRuntime,
    'react-dom': ReactDom,
    'react-dom/client': ReactDomClient,
    '@xrkseek/cordis': Cordis,
    '@xrkseek/client-ui-slots': UiSlots,
    '@xrkseek/client-web-react': WebReact,
    '@xrkseek/client-ui-primitives': UiPrimitives,
    '@xrkseek/client-ui-attachment': UiAttachment,
    '@xrkseek/client-schema-form': SchemaForm,
  } satisfies Record<PlatformModule, unknown>
}
