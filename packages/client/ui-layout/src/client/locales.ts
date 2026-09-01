/** Layout plugin locale seat (`layout` namespace). */

export const NS = 'layout' as const



/** Simplified Chinese dictionary (the key-set source of truth). */

export const zh = {

  'sidebar.open': '打开侧边栏',

  'sidebar.close': '关闭侧边栏',

  'sidebar.dialog': '侧边栏',

} as const



/** The layout namespace key union. */

export type LayoutKey = keyof typeof zh



declare module '@xrkseek/client-ui-slots' {

  interface LocaleNamespaceMap {

    /** Shell frame copy (phone drawer chrome). */

    layout: LayoutKey

  }

}



/** English dictionary, checked complete against the zh key set. */

export const en = {

  'sidebar.open': 'Open sidebar',

  'sidebar.close': 'Close sidebar',

  'sidebar.dialog': 'Sidebar',

} as const satisfies Record<LayoutKey, string>


