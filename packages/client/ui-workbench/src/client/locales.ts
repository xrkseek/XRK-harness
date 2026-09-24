/** `workbench` namespace dictionaries (floating Host `/sidebar/*` panel). */

/** Simplified Chinese dictionary (key-set source of truth). */
export const zh = {
  'title': '工作台',
  'close': '关闭工作台',
  'empty': '选择左侧文件以预览。聊天里点开文件路径也会落在这里（未安装社区侧栏时）。',
  'loading': '加载中…',
  'error': '无法读取',
  'binary': '二进制文件 — 使用 Host 预览或系统打开。',
  'openOs': '用系统打开',
  'tree': '文件',
  'up': '上级目录',
  'refresh': '刷新',
  'truncated': '内容已截断',
} as const

/** English dictionary (mirrors zh keys). */
export const en: { [K in keyof typeof zh]: string } = {
  'title': 'Workbench',
  'close': 'Close workbench',
  'empty': 'Select a file on the left to preview. Chat file opens land here when no community sidebar is installed.',
  'loading': 'Loading…',
  'error': 'Could not read',
  'binary': 'Binary file — use Host preview or open in the OS.',
  'openOs': 'Open in OS',
  'tree': 'Files',
  'up': 'Parent folder',
  'refresh': 'Refresh',
  'truncated': 'Content truncated',
}

/** Key union for the workbench locale namespace. */
export type WorkbenchKey = keyof typeof zh
