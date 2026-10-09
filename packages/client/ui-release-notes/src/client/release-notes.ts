/**
 * Release notes content, shipped IN the bundle.
 *
 * Versioned entries go in {@link RELEASE_NOTES} (newest first). The optional
 * {@link RELEASE_NOTES_PINNED} block is a top-of-dialog notice — not a release
 * and not part of the unread version marker.
 *
 * Nothing here is fetched or persisted: the list is source code, so it travels
 * with the build and cannot drift from what the user actually installed. Only
 * the "which notes did this user open" marker is durable (Host settings — see
 * release-notes-copy.ts).
 */
import type { LocalizedText } from '@xrkseek/client-locale/client'

/** One released version's notes. */
export interface ReleaseNote {
  /** Exact version string, as published. Doubles as the read-marker value. */
  readonly version: string
  /** ISO date (YYYY-MM-DD) of the release. */
  readonly date: string
  /** Localized headline. */
  readonly title: LocalizedText
  /** Localized change bullets, in importance order. */
  readonly changes: readonly LocalizedText[]
}

/**
 * Pinned top-of-dialog notice (thanks, policy, etc.).
 * Not a version — excluded from {@link latestReleaseVersion} / unread compare.
 */
export interface ReleaseNotesPinned {
  /** Localized headline. */
  readonly title: LocalizedText
  /** Localized bullets. */
  readonly changes: readonly LocalizedText[]
}

/**
 * Optional notice rendered above every version entry.
 * Omit (`null`) when there is nothing to pin.
 */
export const RELEASE_NOTES_PINNED: ReleaseNotesPinned | null = {
  title: {
    zh: '致谢',
    en: 'Thanks',
  },
  changes: [
    {
      zh: '感谢 XRK-Harness 制作组的大家。',
      en: 'Thanks to everyone on the XRK-Harness team.',
    },
    {
      zh: '感谢何润景、文具盒、刘雅婷、雨木木、炫彩马桶。',
      en: 'Special thanks to 何润景, 文具盒, 刘雅婷, 雨木木, and 炫彩马桶.',
    },
  ],
}

/**
 * Every released version, newest first.
 *
 * The first entry is the newest release and therefore the one whose id the
 * unread dot compares against; a user who has opened notes at least that new
 * sees no dot.
 */
export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: '0.5.20',
    date: '2026-10-09',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '工具渐进披露（tool_search）与路径越权确认；子代理继承父会话路径权限。',
        en: 'Progressive tool disclosure (tool_search) and path overreach confirm; subagents inherit the parent path permission.',
      },
      {
        zh: '计划模式 Canvas + Build；长工具参数先出卡壳；新 turn 等待提示落在开场消息下。',
        en: 'Plan mode Canvas + Build; streaming tool args paint a card shell first; new-turn waiting tip sits under the opener.',
      },
    ],
  },
  {
    version: '0.5.19',
    date: '2026-10-09',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: 'Desktop Host 启动/崩溃门闩：不再卡在「正在启动 Host」；预算耗尽或 OOM 后可一点重试。',
        en: 'Desktop Host bring-up / crash gate no longer sticks on “Starting host”; retry after budget exhaust or OOM in one click.',
      },
      {
        zh: '修复重连要点两次：先等 Host rebring 再握手；检查更新一点即显示「正在检查」。',
        en: 'Reconnect no longer needs a double tap (await Host rebring first); the update chip paints “Checking…” on the first click.',
      },
    ],
  },
  {
    version: '0.5.18',
    date: '2026-10-09',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '同轮多个独立子代理可真正并行；顶栏 / 概况委派图 / 侧栏预览共用运行中与终态指示。',
        en: 'Sibling subagents in one turn actually run together; top-bar / Overview graph / sidebar preview share live and terminal status.',
      },
      {
        zh: '继续压低大会话 Host 内存与输入卡顿；超长粘贴折叠更稳。',
        en: 'Further cut Host RAM and composer jank on heavy sessions; over-long paste folding is steadier.',
      },
    ],
  },
  {
    version: '0.5.17',
    date: '2026-10-08',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '减轻大会话把 Desktop Host 内存顶爆后自动重启：多步循环不再因 system 注入抖动反复写整段 request/header；关 Host 时可回收虚胖 sessions.db 空页。',
        en: 'Heavy sessions are less likely to OOM-restart the Desktop Host: tool loops no longer append a full request/header on every system-inject jitter; Host shutdown can reclaim freelist bloat in sessions.db.',
      },
    ],
  },
  {
    version: '0.5.16',
    date: '2026-10-08',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: 'Desktop 更新：发现新版本仍自动预下载并显示进度，但「安装并重启」仅在下载完成后可点。',
        en: 'Desktop updates still prefetch with a progress meter, but Install and restart stays disabled until the download is ready.',
      },
    ],
  },
  {
    version: '0.5.15',
    date: '2026-10-08',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '大会话切换与概况软轮询更稳：历史按预算下发，Status 命中缓存不再整段重扫。',
        en: 'Heavy sessions switch more smoothly: history pages stay under a wire budget, and Status soft-polls reuse a revision cache.',
      },
      {
        zh: '修复「加载更早」与轮次跳转：裁切历史后仍保留绝对序号，续拉与轨跳不再被清掉。',
        en: '“Load earlier” and turn-rail jumps stay contiguous: budgeted history keeps absolute seq so paging no longer clears hasMore.',
      },
      {
        zh: '装扮贴纸支持 SVG 并可持久化；眼镜贴纸按半幅跟左右眼缩放（框画在 SVG，不叠引擎黑杠）；概况重开先画缓存；Desktop 开屏可玩小恐龙。',
        en: 'Dressing stickers accept SVG and persist; glasses stickers track each eye on a dual-half canvas (draw the frame in the SVG, no engine black bars). Overview repaints from cache; Desktop splash includes the offline dino.',
      },
      {
        zh: '侧栏变更公告可回看历史版本；未读红点打开后清除。',
        en: 'Sidebar release notes keep past versions readable; the unread dot clears when you open them.',
      },
    ],
  },
  {
    version: '0.5.14',
    date: '2026-10-06',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: 'Desktop 更新改走产品内对话框与下载进度；发现新版本即开始预下载。',
        en: 'Desktop updates use the in-app dialog and download meter, and start fetching as soon as a newer build is on the feed.',
      },
      {
        zh: 'Settings 底栏与 Host 重连同槽提示「有更新」；Windows 无菜单时也可检查/安装。',
        en: 'Settings foot shares the Host-reconnect chip for “update available”; Windows builds without an app menu can still check and install.',
      },
    ],
  },
]

/** Newest released version id, or undefined when no notes are declared. */
export function latestReleaseVersion(): string | undefined {
  return RELEASE_NOTES[0]?.version
}
