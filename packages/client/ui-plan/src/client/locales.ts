/** `plan` namespace dictionaries (the composer plan chip's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.on.aria': 'plan mode 已开启，按下关闭',
  'chip.on.title': 'plan mode 已开启 — 点击关闭（/plan off）',
  'preview.open': '预览',
  'preview.tabs': '计划与 Office 预览',
  'preview.plan': '计划',
  'preview.office': 'Office',
  'preview.close': '关闭预览',
  'preview.loading': '正在读取预览',
  'preview.unavailable': '预览不可用',
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
  'preview.open': 'Preview',
  'preview.tabs': 'Plan and Office preview',
  'preview.plan': 'Plan',
  'preview.office': 'Office',
  'preview.close': 'Close preview',
  'preview.loading': 'Loading preview',
  'preview.unavailable': 'Preview unavailable',
  'preview.yes': 'Yes',
  'preview.no': 'No',
  'preview.plan.active': 'Plan mode',
  'preview.plan.pending': 'Pending commit',
  'preview.office.configured': 'Configured',
  'preview.office.connected': 'Connected',
} satisfies Record<PlanKey, string>
