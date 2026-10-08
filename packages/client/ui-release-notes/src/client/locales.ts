/** Copy dictionaries for the release-notes sidebar button and dialog. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  button: 'Release notes',
  dialogTitle: 'Release notes',
  close: 'Close',
  empty: 'No release notes have been published yet.',
  unreadBadge: 'Unread release notes',
  markFailed: 'The read marker could not be saved. It will return next launch.',
  /** Badge on the pinned top notice (not a version row). */
  pinnedBadge: 'Notice',
  /** Chip on the newest version while the unread marker is still set. */
  unreadChip: 'New',
}

/** The release-notes namespace key union. */
export type ReleaseNotesKey = keyof typeof en

/** Chinese strings (same keys as {@link en}). */
export const zh: { [Key in keyof typeof en]: string } = {
  button: '版本公告',
  dialogTitle: '版本公告',
  close: '关闭',
  empty: '还没有发布过公告。',
  unreadBadge: '有未读公告',
  markFailed: '暂时无法保存已读状态，下次启动会再次提醒。',
  pinnedBadge: '置顶',
  unreadChip: '未读',
}