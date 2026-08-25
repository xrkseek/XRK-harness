/** `settings.permission` namespace dictionaries (the Permission row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '权限',
  'description': '选择新会话的默认权限模式（只读 / 工作区写入 / 完全访问）',
  'loading': '加载中',
  'unavailable': '不可用',
  'confirm.title': '确认启用完全访问？',
  'confirm.description': '完全访问会关闭审批提示，且不再对 shell/PTY 套工作区沙箱。文件工具仍不能写出工作区根。仅在你信任后续任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用完全访问',
} satisfies Record<string, string>

/** The settings.permission namespace key union. */
export type PermissionSettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Permission',
  'description': 'Default mode for new sessions (Read only / Workspace write / Full access)',
  'loading': 'Loading',
  'unavailable': 'Unavailable',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access turns off approval prompts and stops wrapping shell/PTY in the workspace sandbox. File tools still cannot leave the workspace root. Use only when you trust subsequent tasks.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionSettingsKey, string>

/** Simplified Chinese dictionary for the current-session popup gate. */
export const accessZh = {
  'confirm.title': '确认启用完全访问？',
  'confirm.description': '完全访问会关闭审批提示，且不再对 shell/PTY 套工作区沙箱。文件工具仍不能写出工作区根。仅在你信任当前任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用完全访问',
} satisfies Record<string, string>

/** Current-session popup-gate key union. */
export type PermissionAccessKey = keyof typeof accessZh

/** English dictionary for the current-session popup gate. */
export const accessEn = {
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access turns off approval prompts and stops wrapping shell/PTY in the workspace sandbox. File tools still cannot leave the workspace root. Use only when you trust the current task.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionAccessKey, string>
