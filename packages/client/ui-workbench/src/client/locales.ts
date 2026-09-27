/** `workbench` namespace dictionaries (floating Host `/sidebar/*` panel). */

/** Simplified Chinese dictionary (key-set source of truth). */
export const zh = {
  'title': '文件',
  'toggle': '文件',
  'toggleOpen': '打开文件侧栏',
  'toggleClose': '关闭文件侧栏',
  'close': '关闭',
  'empty': '选择左侧文件以预览。聊天里点开文件路径也会落在这里。',
  'loading': '加载中…',
  'error': '无法读取',
  'binary': '二进制文件 — 使用系统打开。',
  'openOs': '用系统打开',
  'tree': '文件',
  'up': '上级',
  'refresh': '刷新',
  'truncated': '内容已截断',
} as const

/** English dictionary (mirrors zh keys). */
export const en: { [K in keyof typeof zh]: string } = {
  'title': 'Files',
  'toggle': 'Files',
  'toggleOpen': 'Open files sidebar',
  'toggleClose': 'Close files sidebar',
  'close': 'Close',
  'empty': 'Select a file on the left to preview. Chat file opens land here.',
  'loading': 'Loading…',
  'error': 'Could not read',
  'binary': 'Binary file — open in the OS.',
  'openOs': 'Open in OS',
  'tree': 'Files',
  'up': 'Up',
  'refresh': 'Refresh',
  'truncated': 'Content truncated',
}

/** Key union for the workbench locale namespace. */
export type WorkbenchKey = keyof typeof zh
