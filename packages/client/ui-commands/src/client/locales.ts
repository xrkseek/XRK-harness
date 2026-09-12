/** `command` namespace dictionaries (builtin Host descriptions + popupSelect shell copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'description.compact': '压缩以上对话内容',
  'description.export': '将当前会话内容导出为 ZIP',
  'description.feedback': '发送关于当前会话的反馈',
  'description.goal': '设置或替换会话目标',
  'description.permission': '切换沙箱模式与审批策略（不是会话工具徽章）',
  'description.plan': '进入或退出计划模式（会话协作；不是工具徽章）',
  'description.mcp': '列出已配置的 MCP 服务器与挂载状态（/mcp verbose 看详情）',
  'description.status': '显示会话徽章、权限、计划、主题、模型、工作目录',
  'description.model': '查看或切换提供方/模型（Codex 风格 /model provider/model）',
  'description.theme': '设置外观偏好（即时生效）：light|dark|system',
  'description.skills': '列出工作区 skills',
  'description.auto-review': '切换 AI 自动审阅，或批准被拒绝的重试',
  'search.placeholder': '搜索…',
  'search.aria': '筛选选项',
  'status.loading': '正在加载选项…',
  'status.applying': '正在应用…',
  'status.empty': '无选项',
  'overlay.aria': '/{command} 选项',
  'listbox.aria': '/{command} 匹配项',
} satisfies Record<string, string>

/** The command namespace key union. */
export type CommandKey = keyof typeof zh

/**
 * English dictionary, checked complete against the zh key set.
 * Built-in description values must match Face `listFaceCommandDescriptors` copy
 * exactly so client localization can detect canonical Host rows.
 */
export const en = {
  'description.compact': 'Compact older conversation history',
  'description.export': 'Download this Session log as a ZIP archive',
  'description.feedback': 'Record feedback about this session',
  'description.goal': 'Set or replace the session goal',
  'description.permission':
    'Switch sandbox mode + approval policy (not the session tool badge)',
  'description.plan':
    'Enter or leave plan mode (session collaboration; not a tool badge)',
  'description.mcp':
    'List configured MCP servers and mount status (/mcp verbose for detail)',
  'description.status': 'Show session badge, permission, plan, theme, model, cwd',
  'description.model':
    'Show or switch provider/model (Codex-style /model provider/model)',
  'description.theme': 'Set appearance preference (live): light|dark|system',
  'description.skills': 'List workspace skills',
  'description.auto-review': 'Toggle AI auto-review or approve a denied retry',
  'search.placeholder': 'Search…',
  'search.aria': 'Filter options',
  'status.loading': 'Loading options…',
  'status.applying': 'Applying…',
  'status.empty': 'No options',
  'overlay.aria': '/{command} options',
  'listbox.aria': '/{command} matches',
} satisfies Record<CommandKey, string>
