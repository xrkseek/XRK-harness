/** `settings.permission` namespace dictionaries (the Permission row's copy). */

/** Locale namespace shared by both current-session permission pickers. */
export const PERMISSION_ACCESS_NS = 'permission.access'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '权限',
  'description': '选择新会话的默认权限模式',
  'loading': '加载中',
  'unavailable': '不可用',
  'preset.readOnly': '仅可查看',
  'preset.workspaceWrite': '可写入工作区',
  'preset.fullAccess': '完全权限',
  'preset.auto': '自动审查',
  'confirm.title': '确认启用完全权限？',
  'confirm.description': '启用完全权限后，新会话将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用完全权限',
} satisfies Record<string, string>

/** The settings.permission namespace key union. */
export type PermissionSettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Permission',
  'description': 'Choose the default permission mode for new sessions',
  'loading': 'Loading',
  'unavailable': 'Unavailable',
  'preset.readOnly': 'Read Only',
  'preset.workspaceWrite': 'Workspace Write',
  'preset.fullAccess': 'Full access',
  'preset.auto': 'Auto review',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access lets new sessions reduce confirmation steps and perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust subsequent tasks.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionSettingsKey, string>

/** Simplified Chinese dictionary for the current-session popup gate. */
export const accessZh = {
  'preset.readOnly': '仅可查看',
  'preset.workspaceWrite': '可写入工作区',
  'preset.fullAccess': '完全权限',
  'confirm.title': '确认启用完全权限？',
  'confirm.description': '启用完全权限后，智能体将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用完全权限',
  'auto.label': '自动审查',
  'auto.badge': 'EXP',
  'auto.description': '无沙箱 + 每调用评审（实验）：每次原生工具与 PTC 内层调用前由分类器（启发式 / HTTP / 会话 LLM）审查。',
  'auto.confirm.title': '确认启用自动审查（实验）？',
  'auto.confirm.description': '自动审查 = 无沙箱 + 每调用评审。每次原生工具调用和 PTC 内层调用前，由启发式 / HTTP / 会话 LLM 三档之一审查；拒绝的调用由你批准或拒绝。此功能仍属实验性，可能误放行或误拒绝，并会消耗额外 token。',
  'auto.confirm.acknowledge': '我已了解这些风险，并愿意继续',
  'auto.confirm.enable': '启用自动审查',
} satisfies Record<string, string>

/** Current-session popup-gate key union. */
export type PermissionAccessKey = keyof typeof accessZh

/** English dictionary for the current-session popup gate. */
export const accessEn = {
  'preset.readOnly': 'Read Only',
  'preset.workspaceWrite': 'Workspace Write',
  'preset.fullAccess': 'Full access',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
  'auto.label': 'Auto review',
  'auto.badge': 'EXP',
  'auto.description': 'No sandbox + per-call review (experimental): every native tool and PTC inner call is reviewed by heuristic / HTTP / session-LLM before run.',
  'auto.confirm.title': 'Enable Auto review (experimental)?',
  'auto.confirm.description': 'Auto review = no sandbox + per-call review. Before every native tool call and PTC inner call, heuristic / HTTP / session-LLM classifies allow vs deny; you approve or reject each denial. Experimental — can falsely allow or deny, and uses extra tokens.',
  'auto.confirm.acknowledge': 'I understand these risks and want to continue',
  'auto.confirm.enable': 'Enable Auto review',
} satisfies Record<PermissionAccessKey, string>
