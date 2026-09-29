/**
 * `model` namespace dictionaries.
 *
 * `trigger.selectAria` reads identically to `trigger.fallback` today and is
 * still a separate key: the visible fallback label and the accessible name of
 * an unset trigger are free to diverge per locale, and folding it into
 * `trigger.aria` would announce the degenerate "Select model, current Select
 * model".
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'command.description': '选择本会话使用的模型',
  'option.loadError': '目录加载失败：{message}',
  'trigger.fallback': '选择模型',
  'trigger.selectAria': '选择模型',
  'trigger.aria': '选择模型，当前 {model}',
  'trigger.ariaEffort': '选择模型，当前 {model}，思考强度 {effort}',
  'menu.aria': '模型与思考强度',
  'menu.model': '模型',
  'menu.effort': '思考强度',
  'effort.providerDefault': '默认',
  'status.loading': '正在刷新模型列表…',
  'status.selecting': '准备中 · 减少等待…',
  'error.action': '模型操作失败：{message}',
  'action.reload': '重新加载',
  'warning.groupLoad': '{name} 加载失败：{message}',
  'empty.models': '没有可用的模型。',
  'search.placeholder': '搜索模型…',
  'search.aria': '筛选模型',
  'search.noResults': '没有匹配的模型。',
  'blocked.composer': '当前模型不可用，请先选择模型',
  'empty.efforts': '当前模型未提供思考强度选项。',
} satisfies Record<string, string>

/** The model namespace key union. */
export type ModelKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'command.description': 'Select the model for this conversation',
  'option.loadError': 'Catalog failed to load: {message}',
  'trigger.fallback': 'Select model',
  'trigger.selectAria': 'Select model',
  'trigger.aria': 'Select model, current {model}',
  'trigger.ariaEffort': 'Select model, current {model}, thinking intensity {effort}',
  'menu.aria': 'Model and thinking intensity',
  'menu.model': 'Model',
  'menu.effort': 'Thinking',
  'effort.providerDefault': 'Default',
  'status.loading': 'Refreshing model list…',
  'status.selecting': 'Preparing · reduced wait…',
  'error.action': 'Model operation failed: {message}',
  'action.reload': 'Reload',
  'warning.groupLoad': '{name} failed to load: {message}',
  'empty.models': 'No models available.',
  'search.placeholder': 'Search models…',
  'search.aria': 'Filter models',
  'search.noResults': 'No matching models.',
  'blocked.composer': 'This model is unavailable — select one to continue',
  'empty.efforts': 'This model provides no thinking intensity levels.',
} satisfies Record<ModelKey, string>
