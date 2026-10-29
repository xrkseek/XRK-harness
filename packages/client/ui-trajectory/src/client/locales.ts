/** Dictionary namespace owned by this plugin. */
export const NS = 'trajectory'

/** The trajectory dictionary key set (the source of truth for both locales). */
export type TrajectoryKey =
  | 'view.trajectory'
  | 'toolbar.aria'
  | 'toolbar.duration'
  | 'toolbar.useActualDuration'
  | 'toolbar.useEqualWidth'
  | 'toolbar.actualTime'
  | 'toolbar.turns'
  | 'toolbar.expandTurns'
  | 'toolbar.collapseTurns'
  | 'toolbar.calls'
  | 'toolbar.expandCalls'
  | 'toolbar.collapseCalls'
  | 'toolbar.search'
  | 'toolbar.searchPlaceholder'
  | 'toolbar.density'
  | 'toolbar.densityCompact'
  | 'toolbar.densityDetailed'
  | 'toolbar.lead'
  | 'timeline.empty'

declare module '@xrkseek/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The trajectory view tab label and toolbar strings. */
    'trajectory': TrajectoryKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<TrajectoryKey, string> = {
  'view.trajectory': '轨迹',
  'toolbar.aria': '轨迹工具栏',
  'toolbar.duration': '时长',
  'toolbar.useActualDuration': '按实际时长',
  'toolbar.useEqualWidth': '等宽操作',
  'toolbar.actualTime': '实际时间',
  'toolbar.turns': '回合',
  'toolbar.expandTurns': '展开回合',
  'toolbar.collapseTurns': '收起回合',
  'toolbar.calls': '调用',
  'toolbar.expandCalls': '展开调用',
  'toolbar.collapseCalls': '收起调用',
  'toolbar.search': '搜索轨迹',
  'toolbar.searchPlaceholder': '搜索',
  'toolbar.density': '密度',
  'toolbar.densityCompact': '紧凑',
  'toolbar.densityDetailed': '详细',
  'toolbar.lead': '按回合复盘：时间线在上，账本在下。点一块看当时的输入、工具和耗时。',
  'timeline.empty': '还没有可复盘的时间线',
}

/** English dictionary. */
export const en: Record<TrajectoryKey, string> = {
  'view.trajectory': 'Trajectory',
  'toolbar.aria': 'Trajectory toolbar',
  'toolbar.duration': 'Duration',
  'toolbar.useActualDuration': 'Use actual duration',
  'toolbar.useEqualWidth': 'Use equal-width operations',
  'toolbar.actualTime': 'Actual time',
  'toolbar.turns': 'Turns',
  'toolbar.expandTurns': 'Expand turns',
  'toolbar.collapseTurns': 'Collapse turns',
  'toolbar.calls': 'Calls',
  'toolbar.expandCalls': 'Expand calls',
  'toolbar.collapseCalls': 'Collapse calls',
  'toolbar.search': 'Search trajectory',
  'toolbar.searchPlaceholder': 'Search',
  'toolbar.density': 'Density',
  'toolbar.densityCompact': 'Compact',
  'toolbar.densityDetailed': 'Detailed',
  'toolbar.lead': 'Review by turn: timeline above, ledger below. Select a block for the prompt, tools, and timing.',
  'timeline.empty': 'No timing data',
}

/** Japanese dictionary, checked complete against the zh key set. */
export const ja = {
  'view.trajectory': '軌跡',
  'toolbar.aria': '軌跡ツールバー',
  'toolbar.duration': '所要時間',
  'toolbar.useActualDuration': '実時間を使う',
  'toolbar.useEqualWidth': '等幅オペレーションを使う',
  'toolbar.actualTime': '実時間',
  'toolbar.turns': 'ターン',
  'toolbar.expandTurns': 'ターンを展開',
  'toolbar.collapseTurns': 'ターンを折りたたむ',
  'toolbar.calls': '呼び出し',
  'toolbar.expandCalls': '呼び出しを展開',
  'toolbar.collapseCalls': '呼び出しを折りたたむ',
  'toolbar.search': '軌跡を検索',
  'toolbar.searchPlaceholder': '検索',
  'toolbar.density': '密度',
  'toolbar.densityCompact': '圧縮',
  'toolbar.densityDetailed': '詳細',
  'toolbar.lead': 'ターン単位で確認：上がタイムライン、下が台帳。ブロックを選ぶとプロンプト・ツール・タイミングを表示します。',
  'timeline.empty': 'タイミングデータなし',
} as const satisfies Record<TrajectoryKey, string>


