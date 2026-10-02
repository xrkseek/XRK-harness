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
}
