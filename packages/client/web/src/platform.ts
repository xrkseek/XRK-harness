/**
 * Shared browser platform modules. Seeding, bundling externals, and Vite
 * aliases consume this list so their module identities cannot drift.
 * @module @xrkseek/client-web/src/platform
 */

/** The module specifiers the shell shares into the frozen module table. */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@xrkseek/cordis',
  '@xrkseek/client-ui-slots',
  '@xrkseek/client-web-react',
  '@xrkseek/client-ui-primitives',
  '@xrkseek/client-ui-attachment',
  '@xrkseek/client-schema-form',
] as const

/** One platform module specifier (a seed-table key). */
export type PlatformModule = (typeof PLATFORM_MODULES)[number]
