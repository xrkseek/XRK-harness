/** Layout plugin locale seat (`layout` namespace). */

export const NS = 'layout' as const

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'sidebar.open': '打开侧边栏',
  'sidebar.close': '关闭侧边栏',
  'sidebar.dialog': '侧边栏',
  'shortcuts.title': '键盘快捷键',
  'shortcuts.close': '关闭',
  'shortcuts.description': '查看与搜索壳层快捷键。自定义与恢复默认将在后续版本开放。',
  'shortcuts.search': '搜索快捷键',
  'shortcuts.empty': '无匹配快捷键',
  'shortcuts.cat.general': '通用',
  'shortcuts.cat.composer': '输入',
  'shortcuts.cat.panels': '面板',
  'shortcuts.openPanel': '打开快捷键面板',
  'shortcuts.submit': '发送消息',
  'shortcuts.newLine': '换行',
  'shortcuts.toggleSidebar': '切换侧边栏',
  'shortcuts.toggleDetails': '切换详情栏',
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
  'shortcuts.title': 'Keyboard shortcuts',
  'shortcuts.close': 'Close',
  'shortcuts.description': 'View and search shell shortcuts. Customize / reset land in a later pass.',
  'shortcuts.search': 'Search shortcuts',
  'shortcuts.empty': 'No matching shortcuts',
  'shortcuts.cat.general': 'General',
  'shortcuts.cat.composer': 'Composer',
  'shortcuts.cat.panels': 'Panels',
  'shortcuts.openPanel': 'Open shortcuts panel',
  'shortcuts.submit': 'Send message',
  'shortcuts.newLine': 'New line',
  'shortcuts.toggleSidebar': 'Toggle sidebar',
  'shortcuts.toggleDetails': 'Toggle details',
} as const satisfies Record<LayoutKey, string>
