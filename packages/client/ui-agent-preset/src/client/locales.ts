/** Locale bundles for the agent-preset settings row, hero chip, header label, and management section. */

/** Locale keys these surfaces render. */
export type AgentPresetSettingsKey =
  | 'title' | 'description' | 'loading' | 'error' | 'userTrust' | 'seatHint' | 'headerHint'
  | 'nav' | 'sectionIntro' | 'builtIn' | 'setDefault' | 'view'
  | 'presetMinimalName' | 'presetMinimalDescription'
  | 'presetShellName' | 'presetShellDescription'
  | 'presetFrugalName' | 'presetFrugalDescription'
  | 'presetPlanName' | 'presetPlanDescription'
  | 'presetShallowName' | 'presetShallowDescription'
  | 'presetHarnessName' | 'presetHarnessDescription'
  | 'duplicate' | 'duplicateUnavailable' | 'delete' | 'presetId' | 'presetIdPlaceholder' | 'copyOf'
  | 'displayName' | 'displayNamePlaceholder'
  | 'inUse' | 'noDescription' | 'builtInGroup' | 'customGroup'
  | 'brokenBadge' | 'brokenNoCopy'
  | 'composition' | 'cancel' | 'close' | 'retry'
  | 'copyTitle' | 'copyIntro' | 'create' | 'creating' | 'creatorDraft'
  | 'openLocation' | 'showLocation' | 'revealedPathLabel'
  | 'idRequired' | 'idInvalid' | 'idTaken'
  | 'deleteTitle' | 'deleteDescription' | 'deleteConfirm' | 'deleting'

/** English copy. */
export const en: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent preset',
  description: 'Applies to sessions you start from now on. Running sessions keep the preset they began with.',
  loading: 'Loading presets…',
  error: 'Could not load agent presets.',
  userTrust: 'Custom',
  seatHint: 'Tool surface for the session you are about to start',
  headerHint: 'Tool surface this session runs, fixed when it started',
  nav: 'Agent presets',
  sectionIntro:
    'XRK ships six built-in tool surfaces — from Minimal and Shell through Frugal, Plan, and Shallow up to XRK Harness. '
    + 'A session badge picks tools, subagents, and whether plan mode starts on; workspace seeds under .xrk feed personality and rules separately.',
  builtIn: 'Built-in',
  setDefault: 'Set as default',
  view: 'View',
  presetMinimalName: 'Minimal',
  presetMinimalDescription:
    'Filesystem, skill, and std tools only — no bash, web, lsp, PTY, or subagents.',
  presetShellName: 'Shell',
  presetShellDescription:
    'Filesystem, bash, and terminal (PTY) — no web, lsp, or subagents.',
  presetFrugalName: 'Frugal',
  presetFrugalDescription:
    'Full coding tools without subagents — lower bill risk.',
  presetPlanName: 'Plan',
  presetPlanDescription:
    'Full tools; starts in plan mode. Approve exit_plan_mode to continue building on the same session.',
  presetShallowName: 'Shallow',
  presetShallowDescription:
    'Full coding tools with one-level subagents only (capped concurrency).',
  presetHarnessName: 'XRK Harness',
  presetHarnessDescription:
    'Full coding agent: filesystem, bash, web, lsp, terminal, and nested subagents.',
  duplicate: 'Duplicate',
  duplicateUnavailable: 'This deployment has no writable preset directory',
  delete: 'Delete',
  presetId: 'Identifier',
  presetIdPlaceholder: 'my-agent',
  displayName: 'Name',
  displayNamePlaceholder: 'Shown in the picker; defaults to the identifier',
  inUse: 'In use',
  builtInGroup: 'Built-in',
  customGroup: 'Custom',
  noDescription: 'No description.',
  brokenBadge: 'Failed to load',
  brokenNoCopy: 'A preset that failed to load cannot be duplicated',
  copyOf: 'Copied from',
  composition: 'Composition',
  cancel: 'Cancel',
  close: 'Close',
  retry: 'Retry',
  copyTitle: 'Duplicate preset',
  copyIntro:
    'The whole preset is copied on this machine. The identifier becomes its directory name and cannot '
    + 'be changed later; everything else is edited in the preset\'s own files.',
  create: 'Create',
  creating: 'Creating…',
  creatorDraft: 'Draft a custom preset',
  openLocation: 'Open folder',
  showLocation: 'Show location',
  revealedPathLabel: 'Preset files:',
  idRequired: 'Give the preset an identifier.',
  idInvalid: 'Use lowercase letters, digits, and hyphens, starting with a letter or digit.',
  idTaken: 'A preset with this identifier already exists.',
  deleteTitle: 'Delete this preset?',
  deleteDescription:
    'The preset directory is deleted. Sessions already running on it keep working; new sessions cannot select it.',
  deleteConfirm: 'Delete',
  deleting: 'Deleting…',
}

/** Simplified Chinese copy. */
export const zh: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent 预设',
  description: '对此后新建的会话生效。运行中的会话保持它开始时的预设。',
  loading: '正在加载预设…',
  error: '无法加载 Agent 预设。',
  userTrust: '自定义',
  seatHint: '即将开始的这个会话所用的工具面',
  headerHint: '本会话的工具面，开始时即固定',
  nav: 'Agent 预设',
  sectionIntro:
    'XRK 内置六种工具面：从 Minimal、Shell，到 Frugal、Plan、Shallow，再到 XRK Harness。'
    + '会话徽章决定工具、子代理与是否默认进入计划模式；工作区 .xrk 种子则另路喂人格与规则。',
  builtIn: '内置',
  setDefault: '设为默认',
  view: '查看',
  presetMinimalName: 'Minimal',
  presetMinimalDescription: '仅文件系统、skill 与 std 工具；无 bash / 联网 / lsp / PTY / 子代理。',
  presetShellName: 'Shell',
  presetShellDescription: '文件系统 + bash + 终端（PTY）；无联网 / lsp / 子代理。',
  presetFrugalName: 'Frugal',
  presetFrugalDescription: '完整编码工具，关闭子代理 — 降低账单风险（省钱）。',
  presetPlanName: 'Plan',
  presetPlanDescription:
    '完整工具；默认进入计划模式。批准 exit_plan_mode 后在同一会话继续构建。',
  presetShallowName: 'Shallow',
  presetShallowDescription: '完整编码工具，仅一层子代理（并限制并发）。',
  presetHarnessName: 'XRK Harness',
  presetHarnessDescription:
    '完整编码 Agent：文件系统、bash、联网、lsp、终端与嵌套子代理。',
  duplicate: '复制',
  duplicateUnavailable: '此部署未配置可写的预设目录',
  delete: '删除',
  presetId: '标识符',
  presetIdPlaceholder: 'my-agent',
  displayName: '名称',
  displayNamePlaceholder: '选择器中显示的名字，缺省用标识符',
  inUse: '当前使用',
  builtInGroup: '内置',
  customGroup: '自定义',
  noDescription: '暂无描述。',
  brokenBadge: '加载失败',
  brokenNoCopy: '预设加载失败，不能复制',
  copyOf: '复制自',
  composition: '组装',
  cancel: '取消',
  close: '关闭',
  retry: '重试',
  copyTitle: '复制预设',
  copyIntro: '整个预设会在本机复制一份。标识符将成为目录名，事后无法更改；其余内容之后直接在预设自己的文件里编辑。',
  create: '创建',
  creating: '正在创建…',
  creatorDraft: '创作自定义预设',
  openLocation: '打开目录',
  showLocation: '查看路径',
  revealedPathLabel: '预设文件：',
  idRequired: '请填写标识符。',
  idInvalid: '只能使用小写字母、数字与连字符，且以字母或数字开头。',
  idTaken: '该标识符已被占用。',
  deleteTitle: '删除该预设？',
  deleteDescription: '预设目录将被删除。已在其上运行的会话不受影响；新会话将无法再选择它。',
  deleteConfirm: '删除',
  deleting: '正在删除…',
}

/** Preset roster fields needed to resolve Web display copy. */
export interface PresetDisplaySource {
  /** Stable preset id. */
  readonly id: string
  /** Whether the deployment ships the preset or the user owns it. */
  readonly trust: 'system' | 'user'
  /** Unlocalized name published by the preset. */
  readonly name?: string
  /** Unlocalized description published by the preset. */
  readonly description?: string
}

/** Display copy resolved for the active Web locale. */
export interface PresetDisplayText {
  /** Localized built-in name or the preset's own fallback name. */
  readonly name: string
  /** Localized built-in description or the preset's own description. */
  readonly description?: string
}

interface PresetLocaleKeys {
  readonly name: AgentPresetSettingsKey
  readonly description: AgentPresetSettingsKey
}

/** Face catalog ids XRK ships (six tiers). */
const BUILT_IN_PRESET_KEYS: Readonly<Partial<Record<string, PresetLocaleKeys>>> = {
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  shell: { name: 'presetShellName', description: 'presetShellDescription' },
  frugal: { name: 'presetFrugalName', description: 'presetFrugalDescription' },
  plan: { name: 'presetPlanName', description: 'presetPlanDescription' },
  shallow: { name: 'presetShallowName', description: 'presetShallowDescription' },
  harness: { name: 'presetHarnessName', description: 'presetHarnessDescription' },
}

/**
 * Resolve preset display copy without making user-authored metadata translatable.
 * Unknown system ids fall through to Face-published name/description.
 */
export function presetDisplayText(
  preset: PresetDisplaySource,
  t: (key: AgentPresetSettingsKey) => string,
): PresetDisplayText {
  const keys = preset.trust === 'system' ? BUILT_IN_PRESET_KEYS[preset.id] : undefined
  if (keys !== undefined) return { name: t(keys.name), description: t(keys.description) }
  return {
    name: preset.name ?? preset.id,
    ...preset.description === undefined ? {} : { description: preset.description },
  }
}
