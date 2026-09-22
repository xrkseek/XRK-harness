/** `plan` namespace dictionaries (the composer plan chip + session overview). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.on.aria': 'plan mode 已开启，按下关闭',
  'chip.on.title': 'plan mode 已开启 — 点击关闭（/plan off）',
  'preview.open': '概况',
  'preview.openHint': '打开右侧概况栏：站立计划、计划模式与 Office',
  'preview.tabs': '会话概况',
  'preview.plan': '计划',
  'preview.todos': '任务',
  'preview.office': 'Office',
  'preview.close': '关闭概况栏',
  'preview.loading': '正在读取概况',
  'preview.unavailable': '概况不可用',
  'preview.todos.empty': '尚无站立计划。Agent 调用 todo_write 后会出现在这里，并跨回合保留。',
  'preview.todos.status.pending': '待处理',
  'preview.todos.status.in_progress': '进行中',
  'preview.todos.status.completed': '已完成',
  'preview.yes': '是',
  'preview.no': '否',
  'preview.plan.active': '计划模式',
  'preview.plan.pending': '等待提交',
  'preview.office.configured': '已配置',
  'preview.office.connected': '已连接',
} satisfies Record<string, string>

/** The plan namespace key union. */
export type PlanKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chip.on.aria': 'Plan mode on, press to turn off',
  'chip.on.title': 'Plan mode on — click to turn off (/plan off)',
  'preview.open': 'Overview',
  'preview.openHint': 'Open the right overview: standing plan, plan mode, and Office',
  'preview.tabs': 'Session overview',
  'preview.plan': 'Plan',
  'preview.todos': 'Todos',
  'preview.office': 'Office',
  'preview.close': 'Close the overview',
  'preview.loading': 'Loading overview',
  'preview.unavailable': 'Overview unavailable',
  'preview.todos.empty': 'No standing plan yet. After the agent calls todo_write, items appear here and persist across turns.',
  'preview.todos.status.pending': 'pending',
  'preview.todos.status.in_progress': 'in progress',
  'preview.todos.status.completed': 'completed',
  'preview.yes': 'Yes',
  'preview.no': 'No',
  'preview.plan.active': 'Plan mode',
  'preview.plan.pending': 'Pending commit',
  'preview.office.configured': 'Configured',
  'preview.office.connected': 'Connected',
} satisfies Record<PlanKey, string>
