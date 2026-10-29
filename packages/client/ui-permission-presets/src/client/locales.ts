/** `settings.permission` namespace dictionaries (the Permission row's copy). */

/** Locale namespace shared by both current-session permission pickers. */
export const PERMISSION_ACCESS_NS = 'permission.access'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '权限',
  'description': '仅作用于编码工作区的新会话默认权限。IM / 向阳空间固定完全访问，不受此项影响。对话中可用 /permission 切换当前编码会话。',
  'boundary': '注意：完全访问跳过 shell 沙箱且不弹审批窗；若仍有需批准的操作则直接拒绝。相对路径仍落在会话工作区，绝对读写跟「额外可写目录」/ 产品家目录。Sandbox Provider 只在工作区写入 / 只读时生效。',
  'roots.label': '额外可写目录',
  'roots.hint': '工作区以外、文件工具可写的绝对路径（默认可读/可写产品家目录）。添加或删除后立即生效。',
  'roots.placeholder': '绝对路径（默认含 ~/.xrk）',
  'roots.add': '添加',
  'roots.remove': '移除',
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
  'auto.confirm.title': '确认启用自动审查（实验）？',
  'auto.confirm.description': '自动审查 = 无沙箱 + 每调用评审。新会话默认每次原生工具与 PTC 内层调用前由分类器审查；拒绝的调用仍需你批准。此功能仍属实验性，可能误放行或误拒绝，并会消耗额外 token。',
  'auto.confirm.acknowledge': '我已了解这些风险，并愿意继续',
  'auto.confirm.enable': '启用自动审查',
} satisfies Record<string, string>

/** The settings.permission namespace key union. */
export type PermissionSettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Permission',
  'description': 'Default permission for new coding-workspace sessions only. IM / Xiangyang stay full access and ignore this setting. In chat use /permission on a coding session.',
  'boundary': 'Note: Full access skips shell confine and approval prompts; residual asks are rejected. Relative paths stay in the session workspace; absolute I/O follows Extra writable roots / product home. Sandbox Provider applies only under Workspace write / Read only.',
  'roots.label': 'Extra writable roots',
  'roots.hint': 'Absolute directories outside the workspace that file tools may write (product home is readable/writable by default). Changes apply immediately.',
  'roots.placeholder': 'Absolute path (defaults include ~/.xrk)',
  'roots.add': 'Add',
  'roots.remove': 'Remove',
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
  'auto.confirm.title': 'Enable Auto review (experimental)?',
  'auto.confirm.description': 'Auto review = no sandbox + per-call review. New sessions review every native tool and PTC inner call before run; denials still ask you. Experimental — can falsely allow or deny, and uses extra tokens.',
  'auto.confirm.acknowledge': 'I understand these risks and want to continue',
  'auto.confirm.enable': 'Enable Auto review',
} satisfies Record<PermissionSettingsKey, string>

/** Japanese dictionary, checked complete against the zh key set. */
export const ja = {
  title: '権限',
  description: 'コーディングワークスペースの新規セッションのみに適用されるデフォルト権限です。IM / 向阳はフルアクセスのまま、この設定を無視します。チャットではコーディングセッションで /permission を使ってください。',
  boundary: '注意: フルアクセスはシェル閉じ込めと承認プロンプトをスキップし、残りの確認は拒否されます。相対パスはセッションワークスペース内に留まり、絶対パスの I/O は追加の書き込み可能ルート / 製品ホームに従います。Sandbox Provider はワークスペース書き込み / 読み取り専用のときのみ適用されます。',
  'roots.label': '追加の書き込み可能ルート',
  'roots.hint': 'ファイルツールが書き込める、ワークスペース外の絶対パスのディレクトリです（プロダクトホームは既定で読み書き可）。変更はすぐ反映されます。',
  'roots.placeholder': '絶対パス（既定には ~/.xrk を含む）',
  'roots.add': '追加',
  'roots.remove': '削除',
  loading: '読み込み中',
  unavailable: '利用不可',
  'preset.readOnly': '読み取り専用',
  'preset.workspaceWrite': 'ワークスペース書き込み',
  'preset.fullAccess': 'フルアクセス',
  'preset.auto': '自動レビュー',
  'confirm.title': 'フルアクセスを有効にしますか？',
  'confirm.description': 'フルアクセスでは、新規セッションの確認手順が減り、機密操作・ファイル変更・外部コマンドなどより多くの操作を直接実行できます。以降のタスクを信頼できる場合のみ使用してください。',
  'confirm.acknowledge': 'リスクを理解したうえで続行します',
  'confirm.cancel': 'キャンセル',
  'confirm.enable': 'フルアクセスを有効化',
  'auto.confirm.title': 'Auto review（実験的）を有効にしますか？',
  'auto.confirm.description': '自動レビュー = サンドボックスなし＋呼び出しごとレビュー。新規セッションではネイティブツールと PTC 内部呼び出しを実行前にレビューし、拒否時のみ確認します。試験的機能 — 誤許可・誤拒否があり得て、トークンも余分に使います。',
  'auto.confirm.acknowledge': 'これらのリスクを理解したうえで続行します',
  'auto.confirm.enable': 'Auto review を有効化',
} as const satisfies Record<PermissionSettingsKey, string>



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

/** Japanese dictionary for the current-session popup gate. */
export const accessJa = {
  'preset.readOnly': '読み取り専用',
  'preset.workspaceWrite': 'ワークスペース書き込み',
  'preset.fullAccess': 'フルアクセス',
  'confirm.title': 'フルアクセスを有効にしますか？',
  'confirm.description': 'フルアクセスでは確認手順が減り、機密操作・ファイル変更・外部コマンドなどより多くの操作を直接実行できます。現在のタスクを信頼できる場合のみ使用してください。',
  'confirm.acknowledge': 'リスクを理解したうえで続行します',
  'confirm.cancel': 'キャンセル',
  'confirm.enable': 'フルアクセスを有効化',
  'auto.label': '自動レビュー',
  'auto.badge': 'EXP',
  'auto.description': 'サンドボックスなし＋呼び出しごとレビュー（実験）: ネイティブツールと PTC 内部呼び出しを、ヒューリスティック / HTTP / セッション LLM が実行前に審査します。',
  'auto.confirm.title': 'Auto review（実験的）を有効にしますか？',
  'auto.confirm.description': '自動レビュー = サンドボックスなし＋呼び出しごとレビュー。ネイティブツールと PTC 内部呼び出しの前にヒューリスティック / HTTP / セッション LLM が許可／拒否を判定し、拒否時のみあなたが承認または却下します。試験的機能 — 誤許可・誤拒否があり得て、トークンも余分に使います。',
  'auto.confirm.acknowledge': 'これらのリスクを理解したうえで続行します',
  'auto.confirm.enable': 'Auto review を有効化',
} satisfies Record<PermissionAccessKey, string>
