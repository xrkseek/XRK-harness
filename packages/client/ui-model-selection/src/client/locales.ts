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
  'trigger.lockedHint': '子代理模型在派发时锁定，可在此查看',
  'trigger.lockedAria': '子代理模型（已锁定）：{model}',
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
  'badge.multimodal': '多模态',
  'badge.multimodalTitle': '支持图片输入',
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
  'trigger.lockedHint': 'Child model is locked at spawn — view only',
  'trigger.lockedAria': 'Child model (locked): {model}',
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
  'badge.multimodal': 'Multimodal',
  'badge.multimodalTitle': 'Accepts image input',
} satisfies Record<ModelKey, string>

/** Japanese dictionary, checked complete against the zh key set. */
export const ja = {
  'command.description': 'この会話のモデルを選択',
  'option.loadError': 'カタログの読み込みに失敗しました: {message}',
  'trigger.fallback': 'モデルを選択',
  'trigger.selectAria': 'モデルを選択',
  'trigger.aria': 'モデルを選択、現在 {model}',
  'trigger.ariaEffort': 'モデルを選択、現在 {model}、思考の強さ {effort}',
  'trigger.lockedHint': '子モデルは起動時にロックされます — 表示のみ',
  'trigger.lockedAria': '子モデル（ロック済み）: {model}',
  'menu.aria': 'モデルと思考の強さ',
  'menu.model': 'モデル',
  'menu.effort': '考え中',
  'effort.providerDefault': '既定',
  'status.loading': 'モデル一覧を更新中…',
  'status.selecting': '準備中 · 待ち時間を短縮…',
  'error.action': 'モデル操作に失敗しました: {message}',
  'action.reload': '再読み込み',
  'warning.groupLoad': '{name} の読み込みに失敗: {message}',
  'empty.models': '利用可能なモデルがありません。',
  'search.placeholder': 'モデルを検索…',
  'search.aria': 'モデルを絞り込み',
  'search.noResults': '一致するモデルがありません。',
  'blocked.composer': 'このモデルは利用できません — 続行するにはモデルを選択してください',
  'empty.efforts': 'このモデルには思考の強さのレベルがありません。',
  'badge.multimodal': 'マルチモーダル',
  'badge.multimodalTitle': '画像入力に対応',
} as const satisfies Record<ModelKey, string>


