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
    'Built-in tool surfaces for ordinary managers in coding workspaces (PI, Shell, Frugal, Shallow, Harness). '
    + 'IM and Qichuang are workspace-locked and ignore this default. Agent-home sessions follow the roster surface, not this picker. /plan is collaboration mode.',
  builtIn: 'Built-in',
  setDefault: 'Set as default',
  view: 'View',
  presetMinimalName: 'PI',
  presetMinimalDescription:
    'Read/write + in-session helpers only (todo / ask / plan / cwd). No terminal, skills, web, office board, peer threads, or delegation.',
  presetImName: 'IM',
  presetImDescription:
    'IM channel: im_send / team / session_query / workspace list·create·session_prompt + subagent(workspace_id) into coding workspaces — no bash, web, lsp, PTY, presence, or thread UI.',
  presetQichuangName: 'Qichuang',
  presetQichuangDescription:
    'Xiangyang surface: team + workspace_* / thread_* + web + lsp + PTY — no nested subagents.',
  presetShellName: 'Shell',
  presetShellDescription:
    'Local coding: PI + bash/jobs, PTY, skills, worktree. Still no web or office collab.',
  presetFrugalName: 'Frugal',
  presetFrugalDescription:
    'Single-session full kit: Shell + web/browser/LSP + office (roster/canvas/session). No peer threads, no subagent delegation.',
  presetShallowName: 'Shallow',
  presetShallowDescription:
    'Frugal + peer threads + subagent delegation. Same-model live sessions hard-capped at 2 (quota-friendly trial).',
  presetHarnessName: 'XRK Harness',
  presetHarnessDescription:
    'Full default surface (same clusters as Shallow). Concurrent live sessions follow agent-loop (default 5).',
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

/** Japanese dictionary, checked complete against the zh key set. */
export const ja = {
  title: 'エージェントプリセット',
  description: '新しいコーディングワークスペースセッションのデフォルトツール面です。IM／奇創はワークスペース固定のためこの既定を無視します。実行中のセッションは開始時のプリセットを維持します。',
  loading: 'プリセットを読み込み中…',
  error: 'エージェントプリセットを読み込めませんでした。',
  userTrust: 'カスタム',
  seatHint: 'これから開始するセッションのツールサーフェス',
  seatLockedIm: 'IM チャネル面 — このワークスペースではロック済み',
  seatLockedQichuang: '奇创サーフェス — 向阳にロック済み',
  headerHint: 'このセッションが動かすツールサーフェス（開始時に固定）',
  nav: 'エージェントプリセット',
  sectionIntro: 'コーディングワークスペースの通常マネージャ向け組み込みツール面（PI、Shell、Frugal、Shallow、Harness）。エージェントホームは名簿の面に従います。',
  builtIn: '組み込み',
  setDefault: 'デフォルトに設定',
  view: '表示',
  presetMinimalName: 'PI',
  presetMinimalDescription: '読み書き＋セッション内ヘルプのみ（todo／ask／plan／cwd）。端末・skill・Web・オフィス・peer・委譲なし。',
  presetImName: 'IM',
  presetImDescription: 'IM チャネル：im_send／team／session_query／workspace の list·create·session_prompt、および coding ワークスペースへの subagent(workspace_id) — bash・web・lsp・PTY・presence・スレッド UI はなし。',
  presetQichuangName: '啓創',
  presetQichuangDescription: '向阳サーフェス: team＋workspace_*／thread_*＋web＋lsp＋PTY — ネストしたサブエージェントなし。',
  presetShellName: 'Shell',
  presetShellDescription: 'ローカル編碼: PI＋bash／jobs、PTY、skill、worktree。Web／オフィス協働はなし。',
  presetFrugalName: 'Frugal',
  presetFrugalDescription: '単一セッションのフルキット: Shell＋web／browser／LSP＋office。peer スレッドなし、サブエージェント委譲なし。',
  presetShallowName: 'Shallow',
  presetShallowDescription: 'Frugal＋peer＋サブエージェント。同一モデルのライブ上限 2（試用向け）。',
  presetHarnessName: 'XRK Harness',
  presetHarnessDescription: '既定のフル面（Shallow と同じクラスタ）。同時ライブは agent-loop（既定 5）に従う。',
  duplicate: '複製',
  duplicateUnavailable: 'このデプロイメントには書き込み可能なプリセットディレクトリがありません',
  delete: '削除',
  presetId: '識別子',
  presetIdPlaceholder: 'my-agent',
  displayName: '名前',
  displayNamePlaceholder: 'ピッカーに表示。未設定時は識別子が使われます',
  inUse: '使用中',
  builtInGroup: '組み込み',
  customGroup: 'カスタム',
  workspaceLockedGroup: 'ワークスペース固定',
  workspaceLockedBadge: 'ワークスペースロック',
  lockedNotSelectable: 'IM／向阳により固定 — coding ワークスペースの Settings 既定ではありません',
  noDescription: '説明はありません。',
  brokenBadge: '読み込みに失敗しました',
  brokenNoCopy: '読み込みに失敗したプリセットは複製できません',
  copyOf: 'コピー元',
  composition: 'コンポジション',
  cancel: 'キャンセル',
  close: '閉じる',
  retry: '再試行',
  copyTitle: 'プリセットを複製',
  copyIntro: 'プリセット全体がこのマシン上にコピーされます。識別子がディレクトリ名になり、あとから変更できません。',
  create: '作成',
  creating: '作成中…',
  creatorDraft: 'カスタムプリセットを下書き',
  openLocation: 'フォルダを開く',
  showLocation: '場所を表示',
  revealedPathLabel: 'プリセットファイル：',
  idRequired: 'プリセットに識別子を付けてください。',
  idInvalid: '先頭は英字または数字。以降は小文字・数字・ハイフン。',
  idTaken: 'この識別子のプリセットは既に存在します。',
  deleteTitle: 'このプリセットを削除しますか？',
  deleteDescription: 'プリセットのディレクトリは削除されます。すでに動作中のセッションはそのまま続き、新規セッションでは選択できません。',
  deleteConfirm: '削除',
  deleting: '削除中…',
} as const satisfies Record<AgentPresetSettingsKey, string>



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
    '普通经理在编码工作区的内置工具面（PI、Shell、Frugal、Shallow、Harness）。'
    + 'IM / 奇创由工作区锁定，不受此项默认影响。干员家开会话跟名册工具面，不跟此选择器。计划模式用 /plan。',
  builtIn: '内置',
  setDefault: '设为默认',
  view: '查看',
  presetMinimalName: 'PI',
  presetMinimalDescription:
    '只读写与会话内协作（todo / 提问 / 计划 / cwd）；无终端、技能、上网、办公板、协作线程、委派。',
  presetImName: 'IM',
  presetImDescription:
    'IM 通道：im_send / team / session_query / workspace 列表·建区·开会话，并可 subagent(workspace_id) 委派到编码区；无 bash / 联网 / lsp / PTY / presence / thread UI。',
  presetQichuangName: '奇创',
  presetQichuangDescription:
    '向阳空间工具面：team + workspace_* / thread_* + web + lsp + PTY；无嵌套子代理。',
  presetShellName: 'Shell',
  presetShellDescription: '本机编码：PI + bash/作业、PTY、技能、worktree；仍无上网与办公协作。',
  presetFrugalName: 'Frugal',
  presetFrugalDescription:
    '单会话全能：Shell + 上网/浏览器/LSP + 办公板（名册/canvas/session）；不能跨会话 peer、不能委派。',
  presetShallowName: 'Shallow',
  presetShallowDescription:
    'Frugal + 协作线程 + 委派；同模型进行中会话硬顶 2（省配额试水）。',
  presetHarnessName: 'XRK Harness',
  presetHarnessDescription:
    '全能力默认档（簇同 Shallow）；并发跟 agent-loop（默认 5）。',
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
