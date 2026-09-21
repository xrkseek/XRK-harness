/** `deliverables` namespace dictionaries. */

export const NS = 'deliverables'

export const zh = {
  'produced.label': '产物',
  'produced.moreOne': '+ 1 个文件',
  'produced.more': '+ {count} 个文件',
  'produced.open': '打开 {name}',
  'produced.preview': '预览 {name}',
  'produced.actions': '{name} 的更多操作',
  'produced.defaultApp': '用默认应用打开',
  'produced.reveal': '在资源管理器中显示',
  'produced.showInFolder': '在文件夹中显示',
  'changes.title': '改动了 {count} 个文件',
  'changes.added': '+{count}',
  'changes.deleted': '-{count}',
  'changes.binary': '二进制',
  'changes.oversized': '过大',
  'changes.openReview': '打开改动审阅',
  'changes.viewDiff': '查看 {name} 的 diff',
  'changes.all': '全部 {count} 个文件',
  'changes.collapse': '收起',
  'changes.expandAria': '展开全部 {count} 个改动文件',
  'changes.collapseAria': '收起改动文件列表',
  'changes.loading': '加载对比…',
  'changes.unavailable': '无法加载此文件的对比',
  'changes.previewFile': '预览 {name}',
}

export const en: Record<DeliverablesKey, string> = {
  'produced.label': 'Produced',
  'produced.moreOne': '+ 1 file',
  'produced.more': '+ {count} files',
  'produced.open': 'Open {name}',
  'produced.preview': 'Preview {name}',
  'produced.actions': 'More file actions for {name}',
  'produced.defaultApp': 'Open in default app',
  'produced.reveal': 'Show in file manager',
  'produced.showInFolder': 'Show in folder',
  'changes.title': '{count} files changed',
  'changes.added': '+{count}',
  'changes.deleted': '-{count}',
  'changes.binary': 'binary',
  'changes.oversized': 'too large',
  'changes.openReview': 'Open changes review',
  'changes.viewDiff': 'View diff for {name}',
  'changes.all': 'All {count} files',
  'changes.collapse': 'Collapse',
  'changes.expandAria': 'Expand all {count} changed files',
  'changes.collapseAria': 'Collapse changed files list',
  'changes.loading': 'Loading comparison…',
  'changes.unavailable': 'Comparison unavailable for this file',
  'changes.previewFile': 'Preview {name}',
}

export type DeliverablesKey = keyof typeof zh
