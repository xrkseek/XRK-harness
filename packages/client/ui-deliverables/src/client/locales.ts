/** `deliverables` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'deliverables'

/** Simplified Chinese dictionary (the key-set source of truth). */
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
}

/** English dictionary (same key set). */
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
}

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof zh
