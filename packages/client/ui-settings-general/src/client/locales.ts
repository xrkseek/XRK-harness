/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'general.title': '通用设置',
  'general.intro':
    '会话默认与外观。侧栏 agent 推送开关写 ~/.xrk/sidebar/prefs.json。「远程」配置 SSH 远端工作区（改完需重启 Host）。模型与密钥在「模型」页；MCP、终端、联网搜索、Agent 循环、沙箱在「插件」页。对话里也可用 /theme · /model · /permission。',
  'sidebarPush.opens.title': '侧栏 agent 打开推送',
  'sidebarPush.opens.description':
    '开启后模型可用 sidebar_open，经 /sidebar/ws/agent-opens 推到侧栏（prefs.agentOpenTools）。',
  'sidebarPush.terminals.title': '侧栏 agent 终端推送',
  'sidebarPush.terminals.description':
    '开启后模型可用 terminal_*，经 /sidebar/ws/agent-terminals 推到侧栏（prefs.agentTerminalTools）。',
  'sidebarPush.saveFailed': '未能写入侧栏 prefs.json',
  'connection.error': '连接异常',
  'connection.retry': '立即重连',
  'connection.connecting': '连接中',
  'connection.phase.initial': '正在启动',
  'connection.phase.host': '正在启动 Host',
  'connection.phase.describe': '正在连接 Host',
  'connection.phase.streams': '正在打开事件流',
  'connection.phase.sessions': '正在加载会话',
  'connection.phase.backoff': '等待重试',
  'connection.connected': '连接成功',
  'connection.reconnect': '连接异常，点击立即重连',
  'connection.restart': '连接中，点击立即重连',
  'release.version': 'v{version}',
  'release.check': '检查更新 v{version}',
  'release.available': '有更新 {version}',
  'release.checking': '正在检查更新',
  'release.install': '安装并重启',
  'release.title': '软件更新',
  'release.detail': '新版本 {version} 已下载完成，可安装并重启。',
  'release.later': '稍后',
  'release.current': '已是最新版本 v{version}',
  'release.downloading': '正在下载 {version}',
  'release.progress': '{percent}%',
  'release.failed': '检查或安装更新失败',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'general.title': 'General',
  'general.intro':
    'Session defaults and appearance. Sidebar agent-push switches write ~/.xrk/sidebar/prefs.json. Remote configures an SSH remote workspace (Host restart required). Models and credentials live under Models; MCP, Shell, web search, agent loop, and sandbox under Plugins. In chat you can also use /theme · /model · /permission.',
  'sidebarPush.opens.title': 'Sidebar agent open push',
  'sidebarPush.opens.description':
    'When on, the model may call sidebar_open and push via /sidebar/ws/agent-opens (prefs.agentOpenTools).',
  'sidebarPush.terminals.title': 'Sidebar agent terminal push',
  'sidebarPush.terminals.description':
    'When on, the model may call terminal_* and push via /sidebar/ws/agent-terminals (prefs.agentTerminalTools).',
  'sidebarPush.saveFailed': 'Could not write sidebar prefs.json',
  'connection.error': 'Disconnected',
  'connection.retry': 'Reconnect now',
  'connection.connecting': 'Connecting',
  'connection.phase.initial': 'Starting up',
  'connection.phase.host': 'Starting host',
  'connection.phase.describe': 'Contacting host',
  'connection.phase.streams': 'Opening event streams',
  'connection.phase.sessions': 'Loading sessions',
  'connection.phase.backoff': 'Waiting to retry',
  'connection.connected': 'Connected',
  'connection.reconnect': 'Disconnected, reconnect now',
  'connection.restart': 'Connecting, restart now',
  'release.version': 'v{version}',
  'release.check': 'Check for updates v{version}',
  'release.available': 'Update {version}',
  'release.checking': 'Checking for updates',
  'release.install': 'Install and restart',
  'release.title': 'Software update',
  'release.detail': 'Version {version} finished downloading. You can install and restart.',
  'release.later': 'Later',
  'release.current': 'You are on the latest version v{version}',
  'release.downloading': 'Downloading {version}',
  'release.progress': '{percent}%',
  'release.failed': 'Could not check or install the update',
} satisfies Record<SettingsKey, string>
