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
    version: '0.6.0-rc.1',
    date: '2026-10-14',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '开启 0.6.x 预览线：归档把日志从热库 sessions.db 分离到 sessions-archive.db；解档迁回；永久删除才抹掉两端；归档页支持批量解档/删除。',
        en: 'Opens the 0.6.x preview line: archiving offloads logs from hot sessions.db into sessions-archive.db; unarchive restores; permanent delete wipes both; archived page supports bulk unarchive/delete.',
      },
      {
        zh: '向阳空间（默认家）+ 奇创工具面；IM 工作区与 im_send/im_reply；跨工作区 workspace_* 编排；回合开头 session_capability / session_posture。',
        en: 'Xiangyang default home + Qichuang surface; IM workspace with im_send/im_reply; cross-workspace workspace_* orchestration; turn-start session_capability / session_posture.',
      },
      {
        zh: '侧栏「插件」入口与版本公告同区；Settings → 插件可浏览工具目录与技能文档；去掉 Advanced 堆叠。',
        en: 'Sidebar Plugins entry shares the utility seat with release notes; Settings → Plugins browses tools/skills catalogs; Advanced stack removed.',
      },
      {
        zh: '站立渐进披露硬规则；种子技能 xrk-presence / xrk-attachment / xrk-craft；分层策展记忆；自动审查权限档。',
        en: 'Standing progressive-disclosure hard rules; seed skills xrk-presence / xrk-attachment / xrk-craft; layered curated memory; Auto-review permission preset.',
      },
      {
        zh: '社区 Host 热卸（live apply）；Computer-use background 模式；本地 SenseVoice STT 缝；划词翻译；fork 谱系。',
        en: 'Community Host live dispose; computer-use background mode; local SenseVoice STT seam; selection translate; fork lineage.',
      },
      {
        zh: 'npm 预发布 @xrkseek/harness-cli@0.6.0-rc.1（@rc）；@latest 仍为 0.5.31。完整清单见 docs/releases/v0.6.0-rc.1.md。',
        en: 'npm prerelease @xrkseek/harness-cli@0.6.0-rc.1 (@rc); @latest stays on 0.5.31. Full list in docs/releases/v0.6.0-rc.1.md.',
      },
    ],
  },
  {
    version: '0.5.31',
    date: '2026-10-12',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '视觉模型读图工具的结果里带着图直接进上下文：Anthropic 的 tool_result、Gemini 的 functionResponse 兄弟 part、OpenAI Responses 的 function_call_output + 后续 user 项都能带图。',
        en: 'Vision-capable models now see the image a read-image tool produced: Anthropic tool_result, Gemini sibling parts next to functionResponse, and OpenAI Responses function_call_output plus a following user item all carry pixels.',
      },
      {
        zh: '每张进请求的图旁边都有一行句柄文本（文件名、attachment sha256 前缀、字节数、请求侧预览尺寸），模型不用再猜图到底是什么。',
        en: 'Every inlined image is preceded by a handle line (name, attachment sha256 prefix, byte size, request-side preview size), so the model stops guessing what it is looking at.',
      },
      {
        zh: '切到纯文本模型时不再中途报错：历史里的图片会换成稳定的占位说明，read_image 也会在动手读盘之前就提示换一个支持图像的模型。',
        en: 'Switching to a text-only model no longer fails mid-turn: retained images become stable placeholders, and read_image refuses before touching the filesystem with a route-switch hint.',
      },
    ],
  },
  {
    version: '0.5.30',
    date: '2026-10-12',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '对话统计与 DSH 对齐：缓存命中按全部计费输入算，上下文环优先用投影值；token 数字随语言本地化。',
        en: 'Conversation stats match DSH: cache-hit covers all billed input, the context ring prefers projected tokens, and figures localize.',
      },
      {
        zh: 'WorkBuddy 国际版不再依赖 Windows 注册表发现，Host 会直接定位到它的 Electron 主程序。',
        en: 'The WorkBuddy international app no longer depends on registry discovery — the Host locates its Electron binary directly.',
      },
    ],
  },
  {
    version: '0.5.29',
    date: '2026-10-12',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '社区模型的思考档位一路送到模型选择器：Our Free Model / WorkBuddy / pi-ai 声明的档位菜单与默认档都会出现。',
        en: 'Community reasoning efforts reach the model picker: Our Free Model / WorkBuddy / pi-ai menus and defaults now show up.',
      },
      {
        zh: '「工具行默认展开」真正生效了；缓存命中率改用正确的分母，暖会话读数不再偏低。',
        en: '“Expand tool rows by default” actually applies, and the cache-hit pill uses the right denominator.',
      },
    ],
  },
  {
    version: '0.5.28',
    date: '2026-10-12',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '社区 Cordis LLM 宿主（Our Free Model · WorkBuddy）共用一套 connection / credentials 桥与 Face 同步；可选产品包 git-worktrees 不再误标「待重启」。',
        en: 'Community Cordis LLM hosts (Our Free Model · WorkBuddy) share one connection / credentials bridge and Face sync; the optional git-worktrees bundle no longer sticky-flags “Restart pending”.',
      },
    ],
  },
  {
    version: '0.5.27',
    date: '2026-10-11',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '主会话有了自己的工作目录：模型可读可切，还能为自己开 linked worktree；插件有了 plugin/record 记录面。',
        en: 'The main session owns a working directory the model can read and change, plus create_worktree; plugins gain plugin/record.',
      },
      {
        zh: '沙箱拦截按名屠杀 node 的命令（精确 PID 仍放行）；max-tokens 自动续跑一路透传；插件页加了 Creator 入口。',
        en: 'The sandbox blocks kill-node-by-name commands (precise PIDs stay allowed); max-tokens auto-continue forwards through; the Plugins page gains a Creator entry.',
      },
    ],
  },
  {
    version: '0.5.26',
    date: '2026-10-11',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '写文件 / 编辑在参数还在流式时就画出 diff；exec-fs 线名接上专用行组件。',
        en: 'Write / edit paint their diff while arguments still stream; exec-fs wire names bind their dedicated rows.',
      },
      {
        zh: '工具行 / 推理行 / 技能行 / 刷新扫光改用合成器动画，并全面支持「减少动态效果」；附件句柄的 modelOnly 不再在线适配层丢失。',
        en: 'Sweeps move to compositor animation and fully honor reduced-motion; modelOnly survives the Face wire adapt.',
      },
    ],
  },
  {
    version: '0.5.25',
    date: '2026-10-10',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '超过上限的大文件不再被拒收，自动转为 @路径 引用；小文件与路径芯片可在同一次拖入共存。',
        en: 'Files over the limit are no longer refused — they become @path references; small files and path chips coexist in one drop.',
      },
      {
        zh: '入料改为先上传后插路径芯片，被拒时草稿不留残片；站立人格新增对用户立场契约。',
        en: 'Intake uploads first and inserts path chips after, so a rejection leaves no strays; the standing persona gains a stance contract.',
      },
    ],
  },
  {
    version: '0.5.24',
    date: '2026-10-10',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '右键菜单在编辑器里走编辑器自己的撤销栈；选中内容不再因菜单偷焦点丢失；复制 / 剪切真正进系统剪贴板。',
        en: 'The context menu drives the editor’s own undo stack; the right-click selection survives focus theft; copy / cut really reach the system clipboard.',
      },
      {
        zh: '菜单打开时外壳不再被挤瘦；技能目录被截断时提示代理自己列目录，别即兴发挥。',
        en: 'An open menu no longer squeezes the shell; a budget-truncated skill catalog tells the agent to list the dirs instead of improvising.',
      },
    ],
  },
  {
    version: '0.5.23',
    date: '2026-10-10',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '回合结束行改锚在 turn/end；工具运行中不再误闪「已停止」；已画出的节点不再消失把对话冻住。',
        en: 'The turn-end row anchors on turn/end; no stray 已停止 while tools run; a painted node never vanishes and freezes the chat.',
      },
      {
        zh: '顶端回合仍在运行时页脚等它收尾；同回合尾部不显示赞。',
        en: 'A tip-turn footer waits until it settles; a mid-turn tail shows no rating.',
      },
    ],
  },
  {
    version: '0.5.22',
    date: '2026-10-10',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '桌面「安装并重启」不再闪回可安装态；粘贴折叠块与查看弹窗改用统一按钮。',
        en: 'Desktop install no longer flashes back to ready; the paste fold and its modal use the shared buttons.',
      },
      {
        zh: '输入框与模态内右键保留原生菜单；侧栏产出文件字号恢复；旧清单键的社区包可加载。',
        en: 'Right-click keeps the native menu in fields and modals; produced-files caption size restored; legacy-key community packages load again.',
      },
    ],
  },
  {
    version: '0.5.21',
    date: '2026-10-10',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '大段粘贴可折叠；回合交付物与 turn-tail 门控更稳；右键菜单原语。',
        en: 'Large pastes fold; turn deliverables and turn-tail gating are stabler; context-menu primitive.',
      },
      {
        zh: 'Settings 推荐安装侧栏与 Office 高保真预览插件；附件句柄对人隐藏（modelOnly）。',
        en: 'Settings recommends sidebar + hi-fi Office preview plugins; attachment handles stay model-only.',
      },
    ],
  },
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
