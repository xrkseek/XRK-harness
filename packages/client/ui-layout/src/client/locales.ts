/** Layout plugin locale seat (`layout` namespace). */

export const NS = 'layout' as const

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'sidebar.open': '打开侧边栏',
  'sidebar.close': '关闭侧边栏',
  'sidebar.dialog': '侧边栏',
  'shortcuts.title': '键盘快捷键',
  'shortcuts.close': '关闭',
  'shortcuts.description': '点击组合键可自定义；Esc 取消录制。发送 / 换行不可改。',
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
  'shortcuts.rebind': '点击以改键',
  'shortcuts.pressKey': '请按键…',
  'shortcuts.reset': '恢复默认',
  'shortcuts.resetAll': '全部恢复默认',
  'shortcuts.conflict': '已与「{name}」冲突',
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
  'shortcuts.description': 'Click a chord to rebind; Esc cancels. Send / newline stay fixed.',
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
  'shortcuts.rebind': 'Click to rebind',
  'shortcuts.pressKey': 'Press a key…',
  'shortcuts.reset': 'Restore default',
  'shortcuts.resetAll': 'Restore all defaults',
  'shortcuts.conflict': 'Conflicts with “{name}”',
} as const satisfies Record<LayoutKey, string>
