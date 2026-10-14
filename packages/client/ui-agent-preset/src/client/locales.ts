/** Locale bundles for the agent-preset settings row, hero chip, header label, and management section. */

/** Locale keys these surfaces render. */
export type AgentPresetSettingsKey =
  | 'title' | 'description' | 'loading' | 'error' | 'userTrust' | 'seatHint' | 'seatLockedIm' | 'seatLockedQichuang' | 'headerHint'
  | 'nav' | 'sectionIntro' | 'builtIn' | 'setDefault' | 'view'
  | 'presetMinimalName' | 'presetMinimalDescription'
  | 'presetImName' | 'presetImDescription'
  | 'presetQichuangName' | 'presetQichuangDescription'
  | 'presetShellName' | 'presetShellDescription'
  | 'presetFrugalName' | 'presetFrugalDescription'
  | 'presetShallowName' | 'presetShallowDescription'
  | 'presetHarnessName' | 'presetHarnessDescription'
  | 'duplicate' | 'duplicateUnavailable' | 'delete' | 'presetId' | 'presetIdPlaceholder' | 'copyOf'
  | 'displayName' | 'displayNamePlaceholder'
  | 'inUse' | 'noDescription' | 'builtInGroup' | 'customGroup'
  | 'workspaceLockedGroup' | 'workspaceLockedBadge' | 'lockedNotSelectable'
  | 'brokenBadge' | 'brokenNoCopy'
  | 'composition' | 'cancel' | 'close' | 'retry'
  | 'copyTitle' | 'copyIntro' | 'create' | 'creating' | 'creatorDraft'
  | 'openLocation' | 'showLocation' | 'revealedPathLabel'
  | 'idRequired' | 'idInvalid' | 'idTaken'
  | 'deleteTitle' | 'deleteDescription' | 'deleteConfirm' | 'deleting'

/** English copy. */
export const en: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent preset',
  description: 'Default tool surface for new coding-workspace sessions. IM / Qichuang are workspace-locked and ignore this default. Running sessions keep the preset they began with.',
  loading: 'Loading presets…',
  error: 'Could not load agent presets.',
  userTrust: 'Custom',
  seatHint: 'Tool surface for the session you are about to start',
  seatLockedIm: 'IM channel surface — locked for this workspace',
  seatLockedQichuang: 'Qichuang surface — locked to Xiangyang',
  headerHint: 'Tool surface this session runs, fixed when it started',
  nav: 'Agent presets',
  sectionIntro:
    'Built-in tool surfaces for coding workspaces (Minimal, Shell, Frugal, Shallow, Harness). '
    + 'IM and Qichuang are workspace-locked (full access) and ignore this default. /plan is collaboration mode.',
  builtIn: 'Built-in',
  setDefault: 'Set as default',
  view: 'View',
  presetMinimalName: 'Minimal',
  presetMinimalDescription:
    'Filesystem, skill, and std tools only — no bash, web, lsp, PTY, or subagents.',
  presetImName: 'IM',
  presetImDescription:
    'IM channel: im_send / team / session_query / workspace list·create·session_prompt + subagent(workspace_id) into coding workspaces — no bash, web, lsp, PTY, presence, or thread UI.',
  presetQichuangName: 'Qichuang',
  presetQichuangDescription:
    'Xiangyang surface: team roster + workspace list·create·session_prompt (peer coding sessions) — no nested subagents, no bash/web/lsp/PTY.',
  presetShellName: 'Shell',
  presetShellDescription:
    'Filesystem, bash, and terminal (PTY) — no web, lsp, or subagents.',
  presetFrugalName: 'Frugal',
  presetFrugalDescription:
    'Full coding tools without subagents — lower bill risk.',
  presetShallowName: 'Shallow',
  presetShallowDescription:
    'Full coding tools with one-level subagents only (concurrency capped by Face).',
  presetHarnessName: 'XRK Harness',
  presetHarnessDescription:
    'Full coding agent: filesystem, bash, web, lsp, terminal, and nested subagents (capped by Face depth/active limits).',
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
  workspaceLockedGroup: 'Workspace-locked',
  workspaceLockedBadge: 'Workspace lock',
  lockedNotSelectable:
    'Pinned by IM / Xiangyang — not a coding-workspace Settings default',
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
  description: '仅作用于编码工作区新会话的默认工具面。IM / 奇创由工作区锁定，不受此项影响。运行中会话保持开始时的预设。',
  loading: '正在加载预设…',
  error: '无法加载 Agent 预设。',
  userTrust: '自定义',
  seatHint: '即将开始的这个会话所用的工具面',
  seatLockedIm: 'IM 通道面 — 本工作区锁定',
  seatLockedQichuang: '奇创工具面 — 锁定向阳空间',
  headerHint: '本会话的工具面，开始时即固定',
  nav: 'Agent 预设',
  sectionIntro:
    '编码工作区内置工具面（Minimal、Shell、Frugal、Shallow、Harness）。'
    + 'IM / 奇创由工作区锁定（完全访问），不受此项默认影响。计划模式用 /plan。',
  builtIn: '内置',
  setDefault: '设为默认',
  view: '查看',
  presetMinimalName: 'Minimal',
  presetMinimalDescription: '仅文件系统、skill 与 std 工具；无 bash / 联网 / lsp / PTY / 子代理。',
  presetImName: 'IM',
  presetImDescription:
    'IM 通道：im_send / team / session_query / workspace 列表·建区·开会话，并可 subagent(workspace_id) 委派到编码区；无 bash / 联网 / lsp / PTY / presence / thread UI。',
  presetQichuangName: '奇创',
  presetQichuangDescription:
    '向阳空间工具面：团队名册 + workspace 列表·建区·开会话派任务（peer，非嵌套子代理）；无 bash / 联网 / lsp / PTY。',
  presetShellName: 'Shell',
  presetShellDescription: '文件系统、bash 与终端（PTY）；无联网 / lsp / 子代理。',
  presetFrugalName: 'Frugal',
  presetFrugalDescription: '完整编码工具，子代理关闭——控制账单（省钱）。',
  presetShallowName: 'Shallow',
  presetShallowDescription: '完整编码工具，仅一层子代理（并发上限由 Face 控制）。',
  presetHarnessName: 'XRK Harness',
  presetHarnessDescription:
    '完整编码 Agent：文件系统、bash、联网、lsp、终端与嵌套子代理（深度 / 并发上限由 Face 控制）。',
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
  workspaceLockedGroup: '工作区锁定',
  workspaceLockedBadge: '工作区锁定',
  lockedNotSelectable: '由 IM / 向阳空间锁定 — 不能设为编码区默认',
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

/** Face catalog ids XRK ships (plan mode is /plan). */
const BUILT_IN_PRESET_KEYS: Readonly<Partial<Record<string, PresetLocaleKeys>>> = {
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  im: { name: 'presetImName', description: 'presetImDescription' },
  qichuang: { name: 'presetQichuangName', description: 'presetQichuangDescription' },
  shell: { name: 'presetShellName', description: 'presetShellDescription' },
  frugal: { name: 'presetFrugalName', description: 'presetFrugalDescription' },
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

/**
 * Label for a session/seat badge id when the selectable roster omitted it
 * (IM / Qichuang are workspace-locked and filtered from Settings pickers).
 * Always prefers locale for known built-ins — never leave raw `qichuang` in zh UI.
 */
export function resolvePresetDisplayText(
  id: string,
  option: PresetDisplaySource | undefined,
  t: (key: AgentPresetSettingsKey) => string,
): PresetDisplayText {
  if (option !== undefined) return presetDisplayText(option, t)
  const keys = BUILT_IN_PRESET_KEYS[id]
  if (keys !== undefined) return { name: t(keys.name), description: t(keys.description) }
  return { name: id }
}
