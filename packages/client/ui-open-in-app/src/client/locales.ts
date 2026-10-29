/** Bilingual copy for the Overview Open In control. */

export const NS = 'open-in-app' as const

export const zh = {
  'open.tooltip': '在本地打开',
  'open.title': '在 {app} 中打开',
  'open.error': '打开失败',
  'menu.toggle': '选择应用',
  'app.finder': 'Finder',
  'app.explorer': '资源管理器',
  'app.filemanager': '文件管理器',
  'app.cursor': 'Cursor',
  'app.vscode': 'VS Code',
  'app.terminal': '终端',
  'app.windowsterminal': 'Windows Terminal',
  'app.iterm': 'iTerm',
  'app.gnometerminal': 'GNOME Terminal',
} as const

export const en = {
  'open.tooltip': 'Open locally',
  'open.title': 'Open in {app}',
  'open.error': 'Open failed',
  'menu.toggle': 'Choose application',
  'app.finder': 'Finder',
  'app.explorer': 'File Explorer',
  'app.filemanager': 'File manager',
  'app.cursor': 'Cursor',
  'app.vscode': 'VS Code',
  'app.terminal': 'Terminal',
  'app.windowsterminal': 'Windows Terminal',
  'app.iterm': 'iTerm',
  'app.gnometerminal': 'GNOME Terminal',
}

/** Japanese dictionary, checked complete against the zh key set. */
export const ja = {
  'open.tooltip': 'ローカルで開く',
  'open.title': '{app} で開く',
  'open.error': '開けませんでした',
  'menu.toggle': 'アプリを選ぶ',
  'app.finder': 'Finder',
  'app.explorer': 'ファイルエクスプローラー',
  'app.filemanager': 'ファイルマネージャー',
  'app.cursor': 'カーソル',
  'app.vscode': 'VS Code',
  'app.terminal': 'ターミナル',
  'app.windowsterminal': 'Windows Terminal',
  'app.iterm': 'iTerm',
  'app.gnometerminal': 'GNOME Terminal',
} as const satisfies Record<OpenInAppKey, string>

export type OpenInAppKey = keyof typeof en
