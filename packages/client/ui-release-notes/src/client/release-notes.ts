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
      zh: '感谢何润景、文具盒、刘雅婷、炫彩马桶、乔晨欣、张利民、徐航、王乐、焦雅、贺吉诚、寇瑞哲、周易恒。',
      en: 'Special thanks to 何润景, 文具盒, 刘雅婷, 炫彩马桶, 乔晨欣, 张利民, 徐航, 王乐, 焦雅, 贺吉诚, 寇瑞哲, and 周易恒.',
    },
    {
      zh: '11.1 祝续航生日快乐！',
      en: 'Nov 1 — happy birthday, 续航!',
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
    version: '0.7.22',
    date: '2026-11-14',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '社区壁纸 / 表情包：装包带 Cordis Host 半；绳绘与关于图直出真资源，不再假像素花屏。',
        en: 'Community wallpaper / stickers: Cordis host half on install; real rope/about art (no fake-pixel glitch).',
      },
      {
        zh: '干员团队改完即存并对齐概况球；工作区发现可调；插件更新探测跟装包同源。',
        en: 'Agent Team saves live and matches Overview balls; tunable workspace discovery; update probes share install registry/proxy.',
      },
      {
        zh: '自定义模型草稿关 Settings 不丢；Desktop 安装包自带 npm 可装社区插件。',
        en: 'Custom-provider drafts survive closing Settings; Desktop ships vendored npm for community installs.',
      },
    ],
  },
  {
    version: '0.7.21',
    date: '2026-11-13',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '工作区 `.xrk/mcp.json` 可叠加 MCP；本席 `mcp_mount` 合并全局 + 会话工作区 + 干员家。',
        en: 'Workspace `.xrk/mcp.json` overlays MCP; this seat’s `mcp_mount` merges global + session workspace + agent-home.',
      },
      {
        zh: '子代理可经父席提问（`ask:` / `answer_ask`）；席位称呼跟 Settings。',
        en: 'Children can ask via the parent seat (`ask:` / `answer_ask`); seat titles follow Settings.',
      },
      {
        zh: '回合注入一事一处并压短；Inject 目录与 Host 实发片段对齐；手机 guest 说明精简。',
        en: 'Leaner one-fact-one-place turn-start inject; Inject catalog matches Host fragments; phone guest copy trimmed.',
      },
      {
        zh: '移除 Settings 插件页 SSH Remote 卡（日常远端改走 MCP）。',
        en: 'Removed the Settings Plugins SSH Remote card (day-to-day remote via MCP).',
      },
    ],
  },
  {
    version: '0.7.20',
    date: '2026-11-13',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '会话写锁可识别假活进程（cmdline / Windows 映像名）；手机单写者可短等回收残留锁。',
        en: 'Session write locks recognize false-alive holders (cmdline / Windows image name); phone single-writer can reclaim a leftover lock after a short wait.',
      },
      {
        zh: '官网下载区与产品壳样式对齐：版本 pill、macOS 提示 xrkh web、CLI 分步；首页摘要改成产品介绍。',
        en: 'Site download block matches the product shell (version pills, macOS xrkh web tip, CLI steps); homepage description is product copy.',
      },
    ],
  },
  {
    version: '0.7.19',
    date: '2026-11-12',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '手机打开概况时，侧栏工作台展开钮与 panel 会收起/隐藏，不再和概况关闭键抢角。',
        en: 'Opening Overview on phone hides/collapses the sidebar workbench expand control so it no longer fights the sheet close button.',
      },
      {
        zh: '壳补上概况「打开」位（LayoutInsets.detailsOpen）；插件清单多端密度与安装路径校验更稳。',
        en: 'Shell publishes LayoutInsets.detailsOpen; plugin inventory density and install-path checks are stabler on multi-end.',
      },
      {
        zh: '侧栏 cwd / 插件包名路径围栏加固；建议侧栏 xrkh-better-sidebar@0.20.9。',
        en: 'Sidebar cwd and plugin package-name path fences harden; prefer xrkh-better-sidebar@0.20.9.',
      },
    ],
  },
  {
    version: '0.7.18',
    date: '2026-11-12',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '设置 → 语言：支持「跟随系统」；旧默认英文偏好迁成跟随系统，界面与席位标题跟本机语言走。',
        en: 'Settings → Language: “Follow system”; old forced English preference migrates so UI and seat titles track the machine locale.',
      },
      {
        zh: '计算机使用默认关闭；向日葵「添加干员工作区」真正开家，测员等不再添加后卡住。',
        en: 'Computer-use defaults to off; Sunflower “Add agent workspace” truly mints a home so roster adds no longer hang.',
      },
      {
        zh: '插件清单双列布局；Desktop 通知不再挂到 Chrome，「命令行 xrkh」读写 PATH 不再冻窗。',
        en: 'Plugin inventory is two-column; Desktop toasts no longer attach to Chrome, and “CLI xrkh” PATH get/set no longer freezes the window.',
      },
      {
        zh: '手机 App：开启「安装未知应用」返回后自动继续安装，不必大退；Host 启动失败时设置球仍在，可进引擎状态。',
        en: 'Mobile App: install continues after “install unknown apps”; on Host start failure the settings ball stays for engine status.',
      },
    ],
  },
  {
    version: '0.7.17',
    date: '2026-11-11',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '对话区模型菜单改为视口 portal：窄屏 / 刘海机上右对齐触发钮后钳入安全边距，活动会话不再裁掉菜单。',
        en: 'Chat model menu uses a viewport portal: right-align to the trigger then clamp into safe margins so active sessions no longer crop it on narrow / notched phones.',
      },
      {
        zh: '手机 App：覆盖更新在 runtime 变更时抬回 `/root`；同 runtime 壳升级只软愈合、不重解整包。',
        en: 'Mobile App: overlay upgrades carry `/root` when the runtime fingerprint changes; shell-only bumps soft-heal without re-extracting rootfs.',
      },
    ],
  },
  {
    version: '0.7.16',
    date: '2026-11-10',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '侧栏会话 / 设置→模型：手机触屏默认可滚动；长按约 0.4 秒后再拖拽重排（滑动会取消长按，不再一按下就锁死滚动）。',
        en: 'Sidebar sessions / Settings → Models: lists stay scrollable on phones; hold ~0.4s then drag to reorder (a slide cancels the hold — press no longer locks scrolling).',
      },
      {
        zh: '工作区打开 / 导出的文件：手机壳走原生下载通道，不再因 blob: 地址下载失败。',
        en: 'Workspace open / exported files: the mobile shell uses the native download channel so blob: URLs no longer fail to save.',
      },
      {
        zh: '首次启动只登记向阳空间：Linux guest（cwd=/root）不再把 `/root` 当成编码工作区。',
        en: 'First boot keeps only Xiangyang: Linux guest (cwd=/root) no longer registers `/root` as a coding workspace.',
      },
      {
        zh: '手机 `xrkh serve` 可钉向阳路径，避免默认 cwd 再挂出一个 root 工作区。',
        en: 'Mobile `xrkh serve` can pin the Xiangyang workspace path so default cwd cannot mint a root project workspace.',
      },
    ],
  },
  {
    version: '0.7.15',
    date: '2026-11-08',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: 'computer_use：坐标点击直接用 capture 截图上的像素（coordinateSpace=window，默认），封装层自动加上窗口原点与客户区偏移，不必自己算 DPI。',
        en: 'computer_use: coordinate clicks now take pixels from the capture screenshot (coordinateSpace=window, the default); the provider adds the window origin and client inset, so no DPI math is needed.',
      },
      {
        zh: 'computer_use：headed 坐标点击后自动把真光标放回原处（preserveCursor，默认开），不再抢走你的鼠标。',
        en: 'computer_use: after a headed coordinate click the real cursor is put back where it was (preserveCursor, default on), so your mouse is not hijacked.',
      },
      {
        zh: 'computer_use：focus_window 支持中文/含空格的窗口名（走 --title，失败回退 --app）；自绘窗口的操作提示改为键盘优先。',
        en: 'computer_use: focus_window now handles Chinese / spaced window names (routes through --title, falls back to --app); custom-drawn windows get keyboard-first guidance.',
      },
      {
        zh: 'agent-desktop：状态根迁到用户可写目录（Windows 为 %LOCALAPPDATA%/xrk-harness-agent-desktop），并自动处理提权残留的租约污染。',
        en: 'agent-desktop: state root moves to a user-writable directory (Windows: %LOCALAPPDATA%/xrk-harness-agent-desktop), with self-healing for elevated leftover leases.',
      },
    ],
  },
  {
    version: '0.7.14',
    date: '2026-11-08',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '设置 → 通用：新增「Git 共同作者」开关（默认开）— 提交说明追加 Co-authored-by: xrkseek；不改 git config / Author。',
        en: 'Settings → General: Git co-author switch (default on) — commit messages append Co-authored-by: xrkseek; never changes git config / Author.',
      },
      {
        zh: 'computer_use：动作按 Provider 收窄；裸 XRK_COMPUTER_USE=1 只软开启（跟 Settings，不钉死 UIA）。',
        en: 'computer_use: actions scoped by Provider; bare XRK_COMPUTER_USE=1 soft-enables (follows Settings, no silent UIA pin).',
      },
      {
        zh: 'Desktop「命令行 xrkh」默认关；agent-desktop 由 Host 解析，不注入 PATH。',
        en: 'Desktop command-line xrkh is off by default; Host resolves agent-desktop without PATH injection.',
      },
      {
        zh: '社区 Host：@earendil-works/pi-ai 升到 1.5.0。',
        en: 'Community Host: @earendil-works/pi-ai moves to 1.5.0.',
      },
    ],
  },
  {
    version: '0.7.13',
    date: '2026-11-08',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: 'Desktop（设置 → 通用）：可选「回合在跑时阻止系统休眠」（息屏后仍可继续；默认关）；会话结束系统通知，支持仅未聚焦 / 总是。',
        en: 'Desktop (Settings → General): optional prevent-idle-sleep while work runs (screen may blank; default off); OS notify on session complete with unfocused / always timing.',
      },
      {
        zh: 'Overview：调整老板球大小不再带动经理球。',
        en: 'Overview: boss ball size no longer scales the manager ball.',
      },
      {
        zh: '归档：安静归档不再误闪「强制归档」确认窗。',
        en: 'Archive: quiet archive no longer flashes the force-archive confirm dialog.',
      },
      {
        zh: '压缩摘要空回复走软失败；Host 重启后清理不会再被认领的排队回声。',
        en: 'Empty compact summarizer soft-fails; Host restart retires local queue echoes it will never claim.',
      },
    ],
  },
  {
    version: '0.7.12',
    date: '2026-11-07',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: 'computer_use：新增 find（按 role/name/text 语义定位，返回新索引）、clipboard_set/clipboard_get；坐标点击必须显式 headed=true（会移动真实光标），headless AX 不抢焦点。',
        en: 'computer_use: add find (semantic locate by role/name/text returning fresh indices), clipboard_set/clipboard_get; coordinate clicks require explicit headed=true (moves the real cursor), headless AX never steals focus.',
      },
      {
        zh: 'browser_*：新增 browser_find（语义定位 + 动作）、browser_frame（iframe 切换）；browser_get 支持 selector；tab label 做 ASCII slug。',
        en: 'browser_*: add browser_find (semantic locate + action), browser_frame (iframe switch); browser_get supports selector; tab labels become ASCII slugs.',
      },
      {
        zh: 'modality 路由：新增 routeAllowsImage 感知实时模型路由；text-only 时 vision/som/browser_vision 软降级（图进 gallery、不进 LLM wire）；<session_capability> 新增 model: 与 modality: 两行。',
        en: 'Modality routing: add routeAllowsImage-aware live model routing; text-only soft-degrades vision/som/browser_vision (images go to gallery, not the LLM wire); <session_capability> gains model: and modality: lines.',
      },
      {
        zh: '提示词文案做了精简：去掉重复说明、统一 @eN 记法、修正若干不完整句子；同时清理了内部 lint 问题，行为不变。',
        en: 'Prompt copy is tighter: duplicate notes removed, @eN unified, fragments rewritten as sentences; internal lint issues cleared. No behaviour change.',
      },
    ],
  },
  {
    version: '0.7.11',
    date: '2026-11-06',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: 'Computer-use / 浏览器代理：agent-desktop 与 agent-browser-session 解析 CLI，fetch-pack 代理支持；桌面 Host 进程与 runtime 准备流程加固。',
        en: 'Computer-use / browser proxy: agent-desktop and agent-browser-session CLI resolution, fetch-pack proxy support; desktop host process and runtime preparation hardened.',
      },
      {
        zh: 'Seat titles 与 settings credentials：seat-titles 模块化，凭据存储加固，status snapshot cache。',
        en: 'Seat titles and settings credentials: seat-titles modularized, credential store hardened, status snapshot cache.',
      },
      {
        zh: 'Voice / TTS：代理 fetch 与 WebSocket agent，TTS 卡片与控制器重构。',
        en: 'Voice / TTS: proxy fetch and WebSocket agent, TTS card and controller refactor.',
      },
      {
        zh: 'UI：seat-caption、PreviewTabs、Menu、WorkspacePicker、ConversationRoot 等交互与布局改进。',
        en: 'UI: seat-caption, PreviewTabs, Menu, WorkspacePicker, ConversationRoot interaction and layout improvements.',
      },
      {
        zh: '文档：settings-fields、status、configuration、computer-use、web-tools 同步更新。',
        en: 'Docs: settings-fields, status, configuration, computer-use, web-tools synced.',
      },
    ],
  },
  {
    version: '0.7.10',
    date: '2026-11-05',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '四区策展记忆真正注入 system prompt，按 ### GLOBAL / WORKSPACE / SESSION / AGENT curated memory 标注；curatedMemory 原样透传，不再只在 === false 时下传；四区注入改用 store 的 isLayered。',
        en: 'Four-zone curated memory is now actually injected into the system prompt, labeled ### GLOBAL / WORKSPACE / SESSION / AGENT curated memory; curatedMemory forwarded verbatim instead of only when === false; four-zone injection now uses the store isLayered predicate.',
      },
      {
        zh: 'Agent 区称呼跟随设置：新增可选 agentLabel，zone 头/工具描述/zoned policy 不再写死「干员」，由 Settings ui-presence 层级叫法决定；Host 从 Face 读 readSeatTitles(...).agent（含自定义 titleAgent）。',
        en: 'Agent-zone label follows settings: new optional agentLabel; zone header/tool description/zoned policy no longer hardcode "干员", driven by Settings ui-presence hierarchy labels; Host reads readSeatTitles(...).agent (including custom titleAgent) from Face.',
      },
      {
        zh: 'USER.md 可写：memory 工具 target 支持 memory | user；描述与 CURATED_MEMORY_PROMPT_TEXT 更新（USER.md 只收用户自述事实）。',
        en: 'USER.md writable: memory tool target now supports memory | user; description and CURATED_MEMORY_PROMPT_TEXT updated (USER.md only collects user-stated facts).',
      },
      {
        zh: '记忆上限可配：新增 CuratedMemoryLimits / resolveCuratedMemoryLimits；createCuratedMemoryStore({ limits })；usage/render 按配置 cap 计算（不再硬编码 2200/1375）。Settings curated-memory ns 新增 memoryLimit/userLimit（step 100, min 200, max 20000, 默认 2200/1375）；插件卡加两个数字字段（三语文案）。',
        en: 'Configurable memory caps: new CuratedMemoryLimits / resolveCuratedMemoryLimits; createCuratedMemoryStore({ limits }); usage/render computed against configured cap (no more hardcoded 2200/1375). Settings curated-memory ns adds memoryLimit/userLimit (step 100, min 200, max 20000, default 2200/1375); plugin card adds two numeric fields (trilingual).',
      },
      {
        zh: '过程折叠头布局修复：.processGroupSummaryLiveInline 被同 specificity 的 .processGroupSummaryLive 覆盖 → 改成 :global([data-process-group]) .processGroupSummaryLiveInline (0,2,0)，活动行贴着工具名左对齐。',
        en: 'Process-header layout fix: .processGroupSummaryLiveInline was overridden by same-specificity .processGroupSummaryLive → now :global([data-process-group]) .processGroupSummaryLiveInline (0,2,0), activity row flush left.',
      },
      {
        zh: 'live 判定回归修复：live = !settled && (...) 让 foldWhen: immediate 恒 settled → 实时工具名消失。改成 running || (!settled && reasoning-only)，33 个 process-group 测试全绿。',
        en: 'Live-gating regression fix: live = !settled && (...) made foldWhen: immediate always settled → live tool name dropped. Now running || (!settled && reasoning-only); 33 process-group tests green.',
      },
      {
        zh: 'TTS 不再注入引导文案：删除 tts-availability.ts 及导出/注册，工具仍由 tts.enabled 绑定；避免 prompt 膨胀。',
        en: 'TTS no longer injects guidance text: deleted tts-availability.ts and its exports/registration; tool still bound by tts.enabled; avoids prompt bloat.',
      },
      {
        zh: '新增 scopedCuratedMemoryPromptText()；policy 文案说明 cap 来自设置。',
        en: 'Added scopedCuratedMemoryPromptText(); policy text notes caps come from settings.',
      },
    ],
  },
  {
    version: '0.7.9',
    date: '2026-11-04',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: 'Voice 产品化：Edge TTS 成为默认引擎（免费、约 300 神经音色、无需 key）；text_to_speech 落盘为会话附件并返回 file block，客户端行内播放条播放。',
        en: 'Voice productization: Edge TTS becomes the default engine (free, ~300 neural voices, no key); text_to_speech now lands as a session attachment returning a file block, played inline.',
      },
      {
        zh: '修复「TTS 音频播不出来」六层 bug：最终根因是 session.attachment 的 RPC 响应 zod 契约只接受 image 形状，file 行被判 invalid_union；已加 fileAttachmentRefSchema + union。',
        en: 'Fixed the six-layer "TTS audio won\'t play" bug: root cause was the session.attachment RPC response zod contract only accepting image shapes, so file rows were invalid_union; added fileAttachmentRefSchema + union.',
      },
      {
        zh: 'TTS 行不再被折进「过程」分组（isStandaloneTranscriptTool 加 text_to_speech）；修「过程 · 思考」永久闪动（live 判定加 !settled）。',
        en: 'TTS rows no longer fold into the "process" group (isStandaloneTranscriptTool now includes text_to_speech); fixed perpetual "process · thinking" flicker (live now requires !settled).',
      },
      {
        zh: 'tts-row 资源泄漏修复（autoPlayers 卸载清理 + autoPlayed 上限 + audio onError）；切引擎时清空 voice/voiceEn；SAPI 音色不存在改为诚实报错；VOICE_MAX_TTS_TEXT = 8000 共享上限。',
        en: 'tts-row resource leak fix (autoPlayers cleanup on unmount + autoPlayed cap + audio onError); clear voice/voiceEn on engine switch; missing SAPI voice now reports honestly; shared VOICE_MAX_TTS_TEXT = 8000 cap.',
      },
      {
        zh: '记忆/技能：memory 工具 target 不再必填；USER.md 归属写清（用户手写、工具不暴露）；三合一 xrk-plugin 旧名残留全清（9 个文件）。',
        en: 'Memory/skills: memory tool target no longer required; USER.md ownership clarified (user writes by hand, tool does not expose it); cleared xrk-plugin old-name residue across 9 files.',
      },
      {
        zh: '底层质量：output-bound 按 text 块真实累加 originalBytes；model-catalog 同 provider 不再重复分组；durable-inject 截断提示抽常量 + 目录条目精确匹配；standing-skill-dirs 收敛为 skillDirs + preferredSkillDirs；layered isLayered 单一判定；Host 默认 TTS 引擎回退值与 schema 对齐（local → edge）。',
        en: 'Underlying quality: output-bound accumulates originalBytes per text block; model-catalog no duplicate groups per provider; durable-inject truncation hint extracted to constant + exact directory-entry match; standing-skill-dirs converged to skillDirs + preferredSkillDirs; layered single isLayered predicate; Host default TTS engine fallback aligned with schema (local → edge).',
      },
      {
        zh: '文档：docs/voice.md、docs/settings-fields.md、docs/status.md、docs/curated-memory.md 同步更新。',
        en: 'Docs: docs/voice.md, docs/settings-fields.md, docs/status.md, docs/curated-memory.md synced.',
      },
    ],
  },
  {
    version: '0.7.8',
    date: '2026-11-04',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '桌面端本机语音修复：安装包随包 sherpa-onnx-node，下完 SenseVoice 模型不再报 Cannot find module（桌面包 win-x64 增大约 23 MB）。',
        en: 'Desktop local voice fixed: the installer now ships sherpa-onnx-node, so finishing the SenseVoice download no longer hits "Cannot find module" (win-x64 package grows ~23 MB).',
      },
      {
        zh: '模型下载代理不再静默失效：非法代理地址直接报错并给出原因，卡片红字提示；voice.inspect 回传代理诊断。',
        en: 'Download proxy no longer fails silently: an unusable proxy address errors with a reason instead of going direct, the card shows a red hint, and voice.inspect echoes the diagnosis.',
      },
      {
        zh: '概览装扮热更：保存干员外观后立即生效，不再等 5 秒状态轮询。',
        en: 'Overview dressing hot-apply: saved agent appearance paints immediately instead of waiting the 5 s status poll.',
      },
      {
        zh: '向阳空间求助通道打通：coding 经理席现可 workspace_session_prompt(ws_default) 向向日葵席投递配置求助；此前该路径被硬闸 refuse，经理席误以为本地能解决一切设置问题。',
        en: 'Xiangyang help-dispatch opened: a coding 经理 seat can now deliver a settings question to a 向日葵 session via workspace_session_prompt(ws_default); the path used to hard-refuse, so coding seats assumed every settings problem was local.',
      },
      {
        zh: '折叠过程头不再丢进度感：折叠且流式时，标题旁同时保留实时工具名与累计活动行（N 条命令 / N 处编辑 / 思考 N 次）；只有一步时不显示计数，避免噪音。',
        en: 'Folded process headers keep their sense of scale: while folded and streaming, the live tool name and the cumulative activity line (N commands / N edits / N thoughts) now show side by side; single-step runs still hide the counts.',
      },
      {
        zh: '文档：新增配置字段全表 docs/settings-fields.md（32 个 namespace，脚本从 schema 生成）。',
        en: 'Docs: new settings field dump docs/settings-fields.md (32 namespaces, generated from the schema by script).',
      },
    ],
  },
  {
    version: '0.7.7',
    date: '2026-11-03',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '语音 ASR/TTS 产品化：本地 SenseVoice 资产下载与就绪检测、ASR/TTS 设置卡片、对话内麦克风按钮与系统 TTS。',
        en: 'Voice ASR/TTS productization: local SenseVoice asset download and readiness, ASR/TTS settings cards, in-composer mic button and system TTS.',
      },
      {
        zh: '子代理路由可固定与追踪：subagent-route-pin 与模型目录守卫。',
        en: 'Pinnable, traceable subagent model routing: subagent-route-pin and model-catalog guard.',
      },
      {
        zh: '启动卡住检测与图片自动降采样：boot-stall、downscale-image。',
        en: 'Boot-stall detection and automatic image downscaling: boot-stall, downscale-image.',
      },
      {
        zh: 'Our Free Model 路由与凭据同步更稳；装扮/对话/附件一批体验修正。',
        en: 'Steadier Our Free Model routing and credential sync; dressing/conversation/attachment polish.',
      },
    ],
  },
  {
    version: '0.7.6',
    date: '2026-11-02',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '表情球装扮扩建：40 形状 · 28 配色 · 12 副眼镜 · 18 顶帽子 · 11 个品牌手持（新增 XRK-harness logo）。',
        en: 'Emotion-ball wardrobe grows: 40 shapes · 28 colors · 12 glasses · 18 hats · 11 brand props (incl. the XRK-harness logo).',
      },
      {
        zh: '球尺寸可在团队面板 0.8–1.2 微调（步进 0.02），团队面板 / 侧栏 / 预览三端同源。',
        en: 'Ball size is adjustable 0.8–1.2 (step 0.02) from the team panel, one source across panel, rail, and preview.',
      },
      {
        zh: '团队面板换装扮即时生效，不必刷新；换回内置装扮也不再残留上一枚贴纸。',
        en: 'Dressing changes apply live in the team panel (no refresh), and switching back to built-ins no longer keeps the old sticker.',
      },
      {
        zh: '检查点快照加三道闸（单文件 10 MiB / 产物后缀 / 目录名），跳过文件如实上报；Desktop 安装包不再塞进第二份 Electron。',
        en: 'Checkpoint snapshots get three gates (10 MiB per file / artifact suffixes / directory names) and report skipped files; the Desktop installer no longer packs a second Electron.',
      },
      {
        zh: '完整清单见 docs/releases/v0.7.6.md。',
        en: 'Full list in docs/releases/v0.7.6.md.',
      },
    ],
  },
  {
    version: '0.7.5',
    date: '2026-11-01',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: 'Desktop 临时分享：本机 / 局域网双地址、PIN、跳过主机专用网卡；关分享即停。',
        en: 'Desktop temporary share: loopback + LAN URLs, PIN, skip host-only NICs; stops when toggled off.',
      },
      {
        zh: '社区插件 Market / Settings 安装·更新后热加载 Host 半；仅失败才需重启。',
        en: 'Community Market / Settings install·update live-applies the Host half; restart only on failure.',
      },
      {
        zh: '完整清单见 docs/releases/v0.7.5.md。',
        en: 'Full list in docs/releases/v0.7.5.md.',
      },
    ],
  },
  {
    version: '0.7.4',
    date: '2026-11-01',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: 'OFM channel-pack 路由可展开模型；社区 RPC 错误信封不再误触 Zod invalid_union。',
        en: 'OFM channel-pack router expands models; community RPC error envelopes no longer trip Zod invalid_union.',
      },
      {
        zh: 'Host 启动后立刻刷新 Face 插件清单（dsh-compat-host 不再等向日葵 warmup）。',
        en: 'Host refreshes Face plugin inventory immediately (dsh-compat-host no longer waits on sunflower warmup).',
      },
      {
        zh: '向日葵免费：模糊挂满目录 + Face 思考档位。',
        en: 'Sunflower free: fuzzy full catalog + Face thinking efforts.',
      },
      {
        zh: '完整清单见 docs/releases/v0.7.4.md。',
        en: 'Full list in docs/releases/v0.7.4.md.',
      },
    ],
  },
  {
    version: '0.7.3',
    date: '2026-11-01',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: 'OFM 仅把 our-free-model / region 同步进 Face；channel-pack 不再拖垮状态轮询与网页。',
        en: 'OFM Face-syncs only our-free-model / region; channel-pack adapters no longer stall status or the web UI.',
      },
      {
        zh: '完整清单见 docs/releases/v0.7.3.md。',
        en: 'Full list in docs/releases/v0.7.3.md.',
      },
    ],
  },
  {
    version: '0.7.2',
    date: '2026-10-31',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '全局 CLI 随包向日葵免费（extensions/xrk-sunflower-free）；无 Bun 仍可走 Kilo。',
        en: 'Global CLI ships Sunflower free (extensions/xrk-sunflower-free); Kilo works without Bun.',
      },
      {
        zh: 'OFM / WorkBuddy 共用 loopback→Face 桥与 Cordis host 底座；OFM 认 actualPort 而非 port:0。',
        en: 'OFM / WorkBuddy share loopback→Face bridge and Cordis host session; OFM uses actualPort, not port:0.',
      },
      {
        zh: '回合等待文案在不支持 background-clip:text 时仍可见。完整清单见 docs/releases/v0.7.2.md。',
        en: 'Turn waiting label stays visible without background-clip:text. Full list in docs/releases/v0.7.2.md.',
      },
    ],
  },
  {
    version: '0.7.1',
    date: '2026-10-31',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '修复过程区：思考展开不再空行；联网工具恢复折叠 ToolRow chrome。',
        en: 'Process chrome: thinking expand shows text again; web tools restore collapsed ToolRow chrome.',
      },
      {
        zh: '向日葵免费对齐 OFM：OpenCode 要 Bun；Kilo 直连不绑 Bun；指纹 UA 2.0.26。',
        en: 'Sunflower free aligned with OFM: OpenCode needs Bun; Kilo is direct without Bun; fingerprint UA 2.0.26.',
      },
      {
        zh: '默认菜单卡片恢复不透明；社区 Settings 无真实 Host API 时不再因缺数组崩页（兜底≠插件可用）。',
        en: 'Default menu cards opaque again; community Settings no longer crash on missing arrays when no real Host API (stub ≠ usable plugin).',
      },
      {
        zh: 'Desktop / CLI 不再随包 Bun。完整清单见 docs/releases/v0.7.1.md。',
        en: 'Desktop / CLI no longer ship Bun. Full list in docs/releases/v0.7.1.md.',
      },
    ],
  },
  {
    version: '0.7.0',
    date: '2026-10-31',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '0.7.x 正式线首发，接管 @latest：上下文工程重排 · 大会话读写 · 席位 / 向日葵命名 · DeepSeek 搜索。',
        en: 'Opens the 0.7.x formal line and takes @latest: context engineering · large-session I/O · seat / sunflower naming · DeepSeek search.',
      },
      {
        zh: '交付物不进过程折叠；软预算对齐 Codex；公网绑定带 PIN；产品 plan 模式退役。',
        en: 'Deliverables stay flat of process fold; Codex-aligned soft budget; public bind with PIN; product plan mode retired.',
      },
      {
        zh: '概况正式名（昵称）；Default Model 软刷新；插话轮次标；向日葵免费卡 · 策展记忆 live。',
        en: 'Overview formal（nick）; Default Model soft refresh; steer round marks; Sunflower-free card · curated-memory live.',
      },
      {
        zh: '聊天键盘焦点环 · 插队中术语 · 轮次轨去 height 动画；turn-cut 分支不因同轮后续节点禁用。',
        en: 'Chat focus rings · steer badge wording · no turn-rail height animation; turn-cut branch stays on with later same-turn nodes.',
      },
      {
        zh: '社区 OFM / channel-pack 登录 RPC · ModuleLoader 双注册 · Cordis Host staging；鲸女 live meter · wallet 根路径。',
        en: 'Community OFM / channel-pack login RPC · ModuleLoader dual-register · Cordis Host staging; whale live meter · wallet roots.',
      },
      {
        zh: '向日葵免费 OpenCode 车道对齐 OFM `/inference/v1` 与 v2 请求头。',
        en: 'Sunflower-free OpenCode lane aligned to OFM `/inference/v1` and v2 headers.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.7.0 接管 @latest。完整清单见 docs/releases/v0.7.0.md。',
        en: 'npm @xrkseek/harness-cli@0.7.0 now owns @latest. Full list in docs/releases/v0.7.0.md.',
      },
    ],
  },
  {
    version: '0.7.0-rc.3',
    date: '2026-10-30',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '席位底层：内置干员多语正式名；向日葵正式名 + 昵称 xrkseek；概况 经理 · 向日葵（xrkseek）。',
        en: 'Seat foundation: locale catalog formals; sunflower formal + nick xrkseek; Overview 经理 · 向日葵（xrkseek）.',
      },
      {
        zh: '概况 / 干员团队：正式名（昵称）；席位卡短签不溢出；改昵称即时上球，改装扮不清昵称。',
        en: 'Overview / Team: formal（nick）; seat tiles short + contained; nick live, look-only keeps nick.',
      },
      {
        zh: '模型设置拖动提供方顺序后 Default Model 卡不再消失（软刷新）。',
        en: 'Models: provider reorder no longer unmounts Default Model (soft refresh).',
      },
      {
        zh: '对话「第 N 轮 插话」；后台子代理父会话镜像延到 prompt/promoted；席位信道前缀。',
        en: 'Chat steer round marks; background-subagent parent mirror waits for prompt/promoted; seat-channel prefixes.',
      },
      {
        zh: '向日葵免费卡 · 策展记忆 live · 移动端 PIN / 特权连接面。完整清单见 docs/releases/v0.7.0-rc.3.md。',
        en: 'Sunflower-free card · curated-memory live · mobile PIN / privileged plane. Full list in docs/releases/v0.7.0-rc.3.md.',
      },
    ],
  },
  {
    version: '0.7.0-rc.2',
    date: '2026-10-30',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: 'DeepSeek 网页搜索：Settings 可钉选（不进 Auto）；web_search 支持 proxy。',
        en: 'DeepSeek web search: pin in Settings (not Auto); web_search accepts proxy.',
      },
      {
        zh: 'present / 提问 / todo / 图视频生成不进「过程」折叠；present 行强制展开。',
        en: 'present / ask / todo / image-video gen stay flat (no process fold); present rows force-expanded.',
      },
      {
        zh: '模型列表冷开无伪 hover；长目录可滚；编辑重发 .ok 误报与截断投影虚增轮次已修。',
        en: 'Model menu: no cold-open pseudo-hover; long lists scroll; edit-resubmit .ok false fail and truncate projection turn inflate fixed.',
      },
      {
        zh: '软预算对齐 Codex：留空按窗×90% 仍主动压；有圆环再取更紧；压缩后保留提供方压力。',
        en: 'Soft budget (Codex): blank = window×90% still proactive; tighter with provider ring; keep pressure across compact.',
      },
      {
        zh: '会话缓存可回收；跨平台文件打开；读图/生图信封；better-sidebar 手机下载；plugin add --proxy；公网 0.0.0.0（免责）。完整清单见 docs/releases/v0.7.0-rc.2.md。',
        en: 'Session-cache reclaim; cross-platform file open; image envelope; better-sidebar mobile download; plugin add --proxy; public bind 0.0.0.0 (disclaimer). Full list in docs/releases/v0.7.0-rc.2.md.',
      },
    ],
  },
  {
    version: '0.7.0-rc.1',
    date: '2026-10-29',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '0.7.x 正式线首个 rc：大会话读写提速（编辑重发尾删 · fork SQL 前缀 · 冷开尾读 / 投影盘缓存）。',
        en: 'First 0.7.x formal-line rc: large-session I/O (edit-resubmit tail-delete · fork SQL prefix · cold tail read / projection disk cache).',
      },
      {
        zh: '上下文工程：Audience 只闸 XRK.md；家约定全席同注；`<instruction_authority>`；skill 渐进披露（无 skill_search）；经理 coding-light / 向阳管设置。',
        en: 'Context engineering: Audience gates XRK.md only; home convention every seat; `<instruction_authority>`; progressive skills (no skill_search); manager coding-light / 向阳 owns Settings.',
      },
      {
        zh: 'Claude Code mods 入产品；Boss 心情条 · 添加干员；产品 plan 模式退役。',
        en: 'Claude Code mods in-product; Boss mood sheet · Add-agent; product plan mode retired.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.7.0-rc.1（@rc）；@latest 仍为 0.6.23。完整清单见 docs/releases/v0.7.0-rc.1.md。',
        en: 'npm @xrkseek/harness-cli@0.7.0-rc.1 (@rc); @latest stays on 0.6.23. Full list in docs/releases/v0.7.0-rc.1.md.',
      },
    ],
  },
  {
    version: '0.6.23',
    date: '2026-10-26',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '子代理不再报「agent scope disposed during materialize」：同一会话两路并发解析只建一次，设置 / MCP 变更也不再杀掉正在启动的会话。',
        en: 'Subagents stop failing with “agent scope disposed during materialize”: two concurrent resolves of one session share a single build, and settings / MCP changes no longer kill a session that is still starting.',
      },
      {
        zh: '工作树租约自愈：检出被删 / 分支没了就标为「已丢失」，快进受阻时给出 ahead / behind，并可「重放后合回」。',
        en: 'Worktree leases heal: a vanished checkout or branch is marked lost, a blocked fast-forward reports ahead / behind, and a replay-then-merge action folds it back.',
      },
      {
        zh: '模型列表刷新按上游增删行、补齐空字段，不覆盖你手改的显示名；社区插件大资源改走 gzip。',
        en: 'Model-list refresh follows the provider listing without overwriting a hand-edited display name; large community plugin assets are gzipped.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.23 接管 @latest。完整清单见 docs/releases/v0.6.23.md。',
        en: 'npm @xrkseek/harness-cli@0.6.23 now owns @latest. Full list in docs/releases/v0.6.23.md.',
      },
    ],
  },
  {
    version: '0.6.22',
    date: '2026-10-25',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '过程收起后显示「查看了 N 个文件…」类活动摘要（对齐 Cursor），不再是「过程 · N 步」。',
        en: 'Folded process rows show a Cursor-style activity line (Explored N files…) instead of “Process · N steps”.',
      },
      {
        zh: '过程详情四档收起时机写清：精简立刻收、标准工具跑完收、详细 Turn 结束再收、始终展开不收。',
        en: 'Process detail fold timing is explicit: Compact immediate, Standard when tools settle, Detailed at Turn end, Always expanded never.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.22 接管 @latest。完整清单见 docs/releases/v0.6.22.md。',
        en: 'npm @xrkseek/harness-cli@0.6.22 now owns @latest. Full list in docs/releases/v0.6.22.md.',
      },
    ],
  },
  {
    version: '0.6.21',
    date: '2026-10-25',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '标准模式结束后过程必折；贴底即时收起，输入框不再被过渡帧抬到中部；工具 settle 后扫光即停。',
        en: 'Standard always folds when a Turn settles; floor-follow folds instantly so the composer stays docked; shimmer stops once tools settle.',
      },
      {
        zh: '队列缩略图与工具卡图片支持同步 peek，展开工具卡预览更大；禁用「转向」仍能看到提示。',
        en: 'Queue thumbs and tool-card images support synchronous peek (larger expanded previews); disabled Steer still shows its tip.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.21 接管 @latest。完整清单见 docs/releases/v0.6.21.md。',
        en: 'npm @xrkseek/harness-cli@0.6.21 now owns @latest. Full list in docs/releases/v0.6.21.md.',
      },
    ],
  },
  {
    version: '0.6.20',
    date: '2026-10-25',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '标准 / 精简：Turn 完成后过程自动收起（跟到底部也会折）；摘要点名工具，进行中扫光并显示当前工具。',
        en: 'Standard / Compact: process auto-folds when a Turn completes (even while following the floor); summaries name tools, and live runs shimmer with the current tool.',
      },
      {
        zh: '过程头整行可点；「过程」与详情留分隔；折叠短内容时输入框仍贴视口底部。',
        en: 'The process header toggles on the whole row; a separator sits between “Process” and the detail; folding short content keeps the composer docked.',
      },
      {
        zh: '设置「过程详情」四档说明写清：精简 / 标准 / 详细 / 始终展开各自的分组、收起与进行中详情。',
        en: 'Settings “Process detail” copy spells out Compact / Standard / Detailed / Always expanded — grouping, fold, and live detail per mode.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.20 接管 @latest。完整清单见 docs/releases/v0.6.20.md。',
        en: 'npm @xrkseek/harness-cli@0.6.20 now owns @latest. Full list in docs/releases/v0.6.20.md.',
      },
    ],
  },
  {
    version: '0.6.19',
    date: '2026-10-24',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '会话列表改读索引列（schema v4 自动迁移）：长库冷列表从秒级到毫秒级；WAL 空闲回落，不再长期停在历史峰值。',
        en: 'Session list reads index columns now (schema v4 auto-migrates): long stores open in milliseconds instead of seconds, and an idle WAL falls back instead of parking at its historical peak.',
      },
      {
        zh: 'Turn 内过程折叠 + 设置「过程详情」：连续思考/工具行可折成一组；视口内不折、折叠不跳字；可调精简到始终展开。',
        en: 'In-Turn process folding + Settings “Process detail”: consecutive reasoning/tool rows can collapse into one group; never inside your viewport, text does not jump; Compact through Always expanded.',
      },
      {
        zh: '图片输入放宽：纯文本路由不再拒图入库（组装时投影占位符）；会话里已有图片也不再阻止切到文本模型。',
        en: 'Relaxed image intake: a text-only route no longer rejects images at admission (placeholders at assembly), and existing images no longer block switching to a text model.',
      },
      {
        zh: '自动续写撞上限时显示「正在自动继续」；被下一步顶替的流式工具行不再一直闪 running；Overview 概况不再卡在「正在读取」。',
        en: 'Auto-continue shows a live max-tokens cue; superseded streaming tool rows stop the running sweep; Overview Status no longer sticks on loading.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.19 接管 @latest。完整清单见 docs/releases/v0.6.19.md。',
        en: 'npm @xrkseek/harness-cli@0.6.19 now owns @latest. Full list in docs/releases/v0.6.19.md.',
      },
    ],
  },
  {
    version: '0.6.18',
    date: '2026-10-24',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '模型探测用 models.dev 补齐容量/思考档/输入模态，Gemini 可列；探测与聊天同走提供方代理；目录有思考档时才会发 reasoning_effort。',
        en: 'Model probe fills capacities / thinking / intake from models.dev, Gemini can list; probe shares the provider proxy; reasoning_effort only when the row advertises levels.',
      },
      {
        zh: '子代理用户跟进会进父会话；半成品 spawn 幽灵不再把「N 个子代理」算多。',
        en: 'Human follow-ups on a child steer into the parent; half-made spawn ghosts no longer inflate the subagent count.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.18 接管 @latest。完整清单见 docs/releases/v0.6.18.md。',
        en: 'npm @xrkseek/harness-cli@0.6.18 now owns @latest. Full list in docs/releases/v0.6.18.md.',
      },
    ],
  },
  {
    version: '0.6.17',
    date: '2026-10-24',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '提供方 / 模型可分层配置 HTTP 代理（模型优先；空则继承环境；direct 强制直连）。',
        en: 'Provider / model HTTP proxy layers (model wins; empty inherits env; direct forces no proxy).',
      },
      {
        zh: '设置面板打开时背景 inert、深链可开分区；触控命中与滚动滚入视口手感加强。',
        en: 'Settings traps focus with inert root and hash deep links; larger hit targets and scroll-into-view polish.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.17 接管 @latest。完整清单见 docs/releases/v0.6.17.md。',
        en: 'npm @xrkseek/harness-cli@0.6.17 now owns @latest. Full list in docs/releases/v0.6.17.md.',
      },
    ],
  },
  {
    version: '0.6.16',
    date: '2026-10-24',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: 'OpenCode Zen/Go 出站带会话头；地区/免费档等失败显示真因，不再伪装成密钥无效。',
        en: 'OpenCode Zen/Go send a session header; region/free-tier failures show the real cause, not a fake invalid key.',
      },
      {
        zh: '会话写锁可回收已死进程；Desktop Host OOM 不自动重启，中途死亡不再叠系统错误框。',
        en: 'Session write lock reclaims dead holders; Desktop Host skips OOM auto-restart and mid-session OS error boxes.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.16 接管 @latest。完整清单见 docs/releases/v0.6.16.md。',
        en: 'npm @xrkseek/harness-cli@0.6.16 now owns @latest. Full list in docs/releases/v0.6.16.md.',
      },
    ],
  },
  {
    version: '0.6.15',
    date: '2026-10-23',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '有活任务时归档会先确认再强制停并归档；限时提问显示剩余秒数。',
        en: 'Archive while busy confirms then force-stops; timed ask shows a live countdown.',
      },
      {
        zh: '内置干员 playbook 带 operator 权威首行；站立种子补 Instruction authority（当时子席跳过家站立；现行解封见 workspace-inject）。',
        en: 'Catalog playbooks open with an operator-authority line; standing seed adds Instruction authority (children skipped home standing at ship; see workspace-inject for current unseal).',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.15 接管 @latest。完整清单见 docs/releases/v0.6.15.md。',
        en: 'npm @xrkseek/harness-cli@0.6.15 now owns @latest. Full list in docs/releases/v0.6.15.md.',
      },
    ],
  },
  {
    version: '0.6.14',
    date: '2026-10-22',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '会话跑完可桌面提醒（窗口未聚焦时）；Host 升级后提示刷新壳，避免旧壳挂新 Host。',
        en: 'Desktop notify when a session finishes (unfocused); reload prompt when Host version drifts from the shell.',
      },
      {
        zh: '限时 ask_user：超时后工具先结案，晚到的回答改走 steer；有活回合/作业/子代理时拒绝静默归档。',
        en: 'Timed ask_user: timeout settles the tool, late answers steer; archive refuses while a turn / job / subagent is live.',
      },
      {
        zh: '子代理超长末条答案落盘可再读；侧栏 Plugins 与发行说明并排紧凑格。',
        en: 'Long subagent final answers spill to disk for re-read; Plugins and release notes share a compact sidebar strip.',
      },
      {
        zh: '概况委派图：连线对齐、去掉幽灵节点与调试腔文案；并发槽含义可悬停查看。',
        en: 'Overview graph: aligned edges, no ghost nodes or debug chips; hover explains concurrent slots.',
      },
    ],
  },
  {
    version: '0.6.13',
    date: '2026-10-21',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '流式回复时 Ctrl+Enter / 打字更跟手：绘制让路给输入，同 run 文本合并，插队回显先画出来。',
        en: 'Streaming stays responsive under Ctrl+Enter / typing: paints yield to input, same-run text merges, and steer echo paints first.',
      },
      {
        zh: '高级干员只改 brief / skills 时，team_save 不再用名册旧文盖掉磁盘 playbook.md；派发与列表吃到最新说明。',
        en: 'Advanced 干员 team_save without playbook no longer overwrites a fresher on-disk playbook.md; spawn and list use the live text.',
      },
      {
        zh: '干员名册「未就绪」环境说明独立成警告面板，按钮不再挤成圆钮。',
        en: 'Team roster Not ready env prep sits in its own warn panel; action buttons no longer crush into circles.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.13 接管 @latest。完整清单见 docs/releases/v0.6.13.md。',
        en: 'npm @xrkseek/harness-cli@0.6.13 now owns @latest. Full list in docs/releases/v0.6.13.md.',
      },
    ],
  },
  {
    version: '0.6.12',
    date: '2026-10-21',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '子智能体会话可贴图 / 拖文件：去掉壳上 intake 门禁，与主会话同轨进 prompt。',
        en: 'Subagent sessions accept images and files: shell intake gate removed; same prompt path as the parent.',
      },
      {
        zh: '子会话锁定模型芯片显示思考强度目录名（如「极高」），不再露出 xhigh 等原始 id。',
        en: 'Locked child model chips show catalog effort names (e.g. 「极高」) instead of raw ids like xhigh.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.12 接管 @latest。完整清单见 docs/releases/v0.6.12.md。',
        en: 'npm @xrkseek/harness-cli@0.6.12 now owns @latest. Full list in docs/releases/v0.6.12.md.',
      },
    ],
  },
  {
    version: '0.6.11',
    date: '2026-10-21',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '高级干员派生不再灌每条 skill 绝对路径：能力板 / preamble 只留 pack_home 与 skills_dir；正文用 skill 工具按名加载。',
        en: 'Spawning an advanced 干员 no longer dumps every skill absolute path: capability / preamble keep pack_home and skills_dir; load bodies with the skill tool by name.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.11 接管 @latest。完整清单见 docs/releases/v0.6.11.md。',
        en: 'npm @xrkseek/harness-cli@0.6.11 now owns @latest. Full list in docs/releases/v0.6.11.md.',
      },
    ],
  },
  {
    version: '0.6.10',
    date: '2026-10-20',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '向阳奇创补齐查网 / 语言服务 / 终端：web · lsp · PTY 与 harness 同档开，仍无嵌套子代理；跨区继续用 workspace_* / thread_*。',
        en: 'Xiangyang Qichuang now matches harness tool switches: web · lsp · PTY on, still no nested subagents; cross-workspace work stays on workspace_* / thread_*.',
      },
      {
        zh: '修好壳里拖 zip 装高级干员：team.export / team.importPack remotes 补挂，名册导入不再报 importPack is not a function；大型公文包可完整落盘。',
        en: 'Fixed drag-install for advanced 干员 zips: team.export / team.importPack remotes are wired so roster import no longer throws; large briefcase packs materialize fully.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.10 接管 @latest。完整清单见 docs/releases/v0.6.10.md。',
        en: 'npm @xrkseek/harness-cli@0.6.10 now owns @latest. Full list in docs/releases/v0.6.10.md.',
      },
    ],
  },
  {
    version: '0.6.9',
    date: '2026-10-20',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '干员能自己长了：用 team_save kind=advanced 把技能、材料和环境准备说明打进一个「公文包 (briefcase)」高级干员；导出的 zip 别人拖进聊天就能装。',
        en: '干员 (Agent Team members) can now grow themselves: team_save kind=advanced packs skills, materials and prep notes into a 公文包 (briefcase) advanced member; the exported zip installs by dragging it into a friend chat.',
      },
      {
        zh: '干员能自己改自己：新增 team_self，子会话里的干员可修订自己的 playbook / brief / inject / tools（父会话仍用 team_save id= 改面）；team_export 导出薄=JSON、高级=zip，预置干员不可导出。',
        en: 'A member can revise itself: new team_self lets a child edit its own playbook / brief / inject / tools (the parent still uses team_save id=). team_export writes thin = JSON and advanced = zip; catalog seeds cannot be exported.',
      },
      {
        zh: '高级包带 workspace/ 材料树：会话 cwd 仍继承父工作区，pack 是公文包（briefcase），能力板注入 pack_home / materials / skills_dir，干员可读写或复制进工作区；分享 zip 用相对路径。',
        en: 'Advanced packs carry a workspace/ materials tree: session cwd stays the parent workspace; the pack is a briefcase with pack_home / materials / skills_dir injected so the child can read, edit, or copy into the workspace; zip share uses relative paths.',
      },
      {
        zh: '包安装更保险：布局白名单校验（散文件与空技能目录直接拒），team_remove 按 scope 卸载，找不到成员时会区分「不存在」和「在别的画布」并给出下一步。',
        en: 'Pack installs are safer: whitelist-validated layout (stray files and empty skill dirs are refused), team_remove uninstalls per scope, and a missing member now distinguishes not-found from lives-in-another-canvas with a next step.',
      },
      {
        zh: '七个 team 工具统一走调用卡片呈现，Team 面板与工具调用同步可见。',
        en: 'All seven team tools now render as call cards, so the Team panel mirrors every tool call.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.9 接管 @latest。完整清单见 docs/releases/v0.6.9.md。',
        en: 'npm @xrkseek/harness-cli@0.6.9 now owns @latest. Full list in docs/releases/v0.6.9.md.',
      },
    ],
  },
  {
    version: '0.6.8',
    date: '2026-10-20',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '干员可以打包分享了：新增高级干员包 xrk-agent-pack（zip 或目录：playbook.md + 只给子会话的 skills/ + env/SETUP.md 准备说明），别人发的包直接拖进聊天即可安装。',
        en: '干员 (Agent Team members) are now packageable and shareable: the new advanced pack kind xrk-agent-pack (zip or directory: playbook.md + child-only skills/ + env/SETUP.md prep notes) can be dragged straight into chat to install.',
      },
      {
        zh: 'team_import 新增 pack= 通道，接受本机路径或 attachment:sha256:…；与薄卡 card= 互斥。scope 缺省不同：card= 落 workspace，pack= 落 global。',
        en: 'team_import gains a pack= channel accepting a local path or attachment:sha256:…, mutually exclusive with the thin card= form. Scope defaults differ: card= lands in workspace, pack= in global.',
      },
      {
        zh: '导入的高级包默认未就绪：先看 team_list 给的 envPrep，准备完再 team_ready 才放开派发。包内脚本永不自动执行，包内 skills 只进子会话目录、不污染父会话。',
        en: 'Imported advanced packs start not-ready: follow the envPrep from team_list, then team_ready unlocks dispatch. Pack scripts never auto-run, and pack skills land only in the child catalog — the parent stays clean.',
      },
      {
        zh: '名册区分 thin / advanced 两类并明确 scope 可见性：global 全工作区可见、workspace 仅当前画布。找不到某个 id 时会提示「用 scope=global 重导或去那个工作区」，不再只回一句不存在。',
        en: 'The roster distinguishes thin from advanced and spells out scope visibility: global shows in every workspace, workspace only in the current canvas. A missing id now suggests re-importing with scope=global or opening that workspace, instead of a bare not-found.',
      },
      {
        zh: '导出与导入更可诊断：thin 出 .json、advanced 出 .zip（文件名已清洗）；导入失败分成「zip 解压失败 / 不是本产品包 / JSON 结构不对」三种文案。对高级 id 调 team_save 会被拒绝。',
        en: 'Export and import are easier to diagnose: thin exports .json, advanced .zip (sanitized names), and import failures split into unzip-failed / not-an-XRK-pack / bad-JSON-shape. team_save on an advanced id is now refused.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.8 接管 @latest。完整清单见 docs/releases/v0.6.8.md。',
        en: 'npm @xrkseek/harness-cli@0.6.8 now owns @latest. Full list in docs/releases/v0.6.8.md.',
      },
    ],
  },
  {
    version: '0.6.7',
    date: '2026-10-20',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '附件本地存储与 DSH 附件桥接线：OFM free-lane 图像 resolver 与 channel-pack 的 readImage / saveImage 统一走 Cordis attachments 座位，字节落产品本地内容寻址库（{XRK_HOME}/attachments/v1），不再各插件各存一份。',
        en: 'Local attachment storage and the DSH attachments bridge are wired: the OFM free-lane image resolver and channel-pack readImage / saveImage all go through the Cordis attachments seat, landing bytes in the product’s local content-addressed store ({XRK_HOME}/attachments/v1) instead of one copy per plugin.',
      },
      {
        zh: 'token usage 协议统一四种供应商形状（OpenAI chat / Responses / Anthropic / Gemini），gemini 与 openai-responses 开始上报 usage；上下文压力优先用 totalTokens、否则 input + cacheRead，不再把 cacheWrite 计入窗口——Context 环不再被高估。',
        en: 'The token-usage protocol unifies four vendor shapes (OpenAI chat / Responses / Anthropic / Gemini), and gemini plus openai-responses now report usage; context pressure prefers totalTokens, else input + cacheRead, and no longer counts cacheWrite — the Context ring stops being overstated.',
      },
      {
        zh: '命令面板按 frecency 排序：空查询按使用频次上浮、命中查询同分由频次打破；排序是设备本地的，不进 Host 设置。',
        en: 'The command palette ranks by frecency: with an empty query frequent commands float up, and ties on matches break by usage; the order is device-local and never enters Host settings.',
      },
      {
        zh: 'Alt+← / Alt+→ 循环切换子代理：在团队根会话与健康直系子会话之间排环跳转（可改键）；没有兄弟会话时不吞键。模型面板的提供方长按 420ms 拖动排序，列表顺序同时作用到 composer 的模型分组。',
        en: 'Alt+← / Alt+→ cycles subagents: hops around the ring of team root plus healthy direct children (rebindable), and never swallows the chord when there are no siblings. In Settings → Models, long-press a provider for 420ms to drag-reorder, and the same order drives the composer’s model groups.',
      },
      {
        zh: 'todo_write 完成纪律改为动态注入：只有清单还有未结项时才追加「同轮标完成」提示，全部结清即撤；快捷键面板宽屏分 1/2/3 栏，干员导入按钮在草稿态也可见。',
        en: 'todo_write completion discipline is now injected dynamically: the “mark completed in the same turn” tip appears only while open items remain and disappears once settled; the shortcuts panel splits into 1/2/3 columns on wide screens, and the roster import button shows in the draft state too.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.7 接管 @latest。完整清单见 docs/releases/v0.6.7.md。',
        en: 'npm @xrkseek/harness-cli@0.6.7 now owns @latest. Full list in docs/releases/v0.6.7.md.',
      },
    ],
  },
  {
    version: '0.6.6',
    date: '2026-10-20',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '会话工程身份 kind 成文并接线：从 badge / 工作区 / 子代理链路派生 orchestrator · coding_parent · delegated_child · fork_clone，turn-start 板与工具 dynamicSchema 按身份重写动词，模型不用再猜 subagent / workspace_session_prompt / thread_message 该找谁。',
        en: 'Session engineering identity kind is documented and wired: orchestrator · coding_parent · delegated_child · fork_clone are derived from badge / workspace / subagent lineage, and the turn-start board plus tool dynamicSchemas rewrite their verbs by identity — no more guessing who subagent / workspace_session_prompt / thread_message belongs to.',
      },
      {
        zh: '干员小队板：委托子会话在 turn-start 看到同父队友与自身任务；同父干员 attach 时自动 peer 互连（label=sibling，不覆盖手改）。子代理默认可续、跟父模型，舰队级 subagentModel 设置整项删除。',
        en: 'Delegated children see their own squad at turn start — same-parent teammates and the assigned task; same-parent children auto-link as peers (label=sibling, never overwriting a manual edit). Children default to continuable and inherit the parent model, and the fleet-level subagentModel setting is gone entirely.',
      },
      {
        zh: '子代理座位改用锁定芯片展示已钉选的模型与权限档，切换被拒绝也不再停在「选择模型」；一次性子会话的输入区只读，占位写清原因，可续子会话仍可 steer / followup。',
        en: 'Subagent seats show locked chips for the pinned model and permission tier, so a refused switch no longer strands you on "select a model"; one-shot children get a read-only composer with the reason in the placeholder, while continuable ones still accept steer / followup.',
      },
      {
        zh: '添加工作区先落位置磁贴（主目录 / 桌面 / 文档 / 下载 / 磁盘 · 最近），路径走 OS 真源解析（Windows Known Folder / macOS osascript / Linux XDG，英文 / 中文 / OneDrive 作回退）；列浏览 Esc 先回磁贴，上次成功的磁贴本地缓存。',
        en: 'Add Workspace opens on place tiles (home / desktop / documents / downloads / drives · recent) resolved from the real OS source (Windows Known Folder / macOS osascript / Linux XDG, with English / Chinese / OneDrive fallbacks); Esc steps back from column browsing to the tiles, and the last successful tile is cached locally.',
      },
      {
        zh: '策展记忆缺省写区写清：主会话默认 scope=session，带 memberId 的干员默认 agent；会话结束的 Phase1/2 写入该会话的分层 store，不再误走单独 home-only global provider；action 或非空 operations 必填，报错可直接行动。',
        en: 'Curated memory default zones are spelled out: main sessions default to scope=session and children with a memberId default to agent; end-of-session Phase1/2 writes land in that session’s layered store instead of a stray home-only global provider, and a missing action or empty operations now errors with something you can act on.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.6 接管 @latest。完整清单见 docs/releases/v0.6.6.md。',
        en: 'npm @xrkseek/harness-cli@0.6.6 now owns @latest. Full list in docs/releases/v0.6.6.md.',
      },
    ],
  },
  {
    version: '0.6.5',
    date: '2026-10-19',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '策略规则新增可选的 match.when，可以按参数内容决定拦不拦（例如只拦 bash 里的递归删除，其余命令照放）。表达式在加载时编译，不能用 eval / vm，赋值、未知变量、原型链访问在编译期就被拒；不引入第二套策略引擎。',
        en: 'Policy rules take an optional match.when, so a rule can decide by argument content (deny recursive delete inside bash and let the rest through). The expression compiles at load — no eval or vm, and assignment, unknown identifiers and prototype walks are rejected at compile time. No second policy engine.',
      },
      {
        zh: '读文件改为在打开的那一刻才认符号链接（O_NOFOLLOW + 对已打开描述符复核），先查后开之间换链接绕过围栏的窗口关掉了；派生子进程不再继承名字含 KEY / PASSWORD / SECRET / TOKEN 的变量和 XRK_ / DSH_ 身份变量，显式传下去的仍传得到。',
        en: 'Reads now trust a symlink only at open time (O_NOFOLLOW plus a re-check on the open descriptor), closing the check-then-open window that defeated the path jail; spawned children inherit no KEY / PASSWORD / SECRET / TOKEN variables and no XRK_ / DSH_ identity, while anything passed explicitly still gets through.',
      },
      {
        zh: '在 CRLF 文件上贴一份 LF 排版的 old_content 不再直接报「找不到」：字面量匹配分成精确、逐行去尾空白、逐行 trim 三级，并回报命中哪一级；歧义匹配仍然报错，不静默改错处。',
        en: 'Pasting LF-shaped old_content onto a CRLF file no longer fails as "not found": literal matching works in three tiers — exact, per-line trailing-whitespace strip, per-line trim — and reports which one hit. Ambiguous matches still error instead of silently editing the wrong spot.',
      },
      {
        zh: '一个回合的多次模型调用共享同一条 trace-id、每步铸新的 span-id，四家 Provider 的出站请求都带上；上游报错的摘要里现在直接附 request-id，并认 cf-ray 与 AWS 的 requestid，跨网关的失败终于可对账。',
        en: 'Calls inside one turn share a trace-id with a fresh span-id per step, and all four providers send it outbound. Failure summaries now append the request-id and read cf-ray plus the AWS requestid headers, so gateway-side failures are finally reconcilable.',
      },
      {
        zh: 'Shell Hook 补到 14 类事件：新增 SessionEnd、Interrupt、PreModelRequest、PostModelRequest。会话首轮算 SessionStart(source: startup)，被打断或取消的回合触发 Interrupt，每次模型调用前后各触发一次；SessionEnd 强制同步执行。',
        en: 'Shell Hooks reach 14 event names with SessionEnd, Interrupt, PreModelRequest and PostModelRequest. A session’s first turn fires SessionStart(source: startup), an aborted or interrupted turn fires Interrupt, and every model call brackets itself with the two request events; SessionEnd must run synchronously.',
      },
      {
        zh: '技能目录超出注入预算时可选按相关性整条取舍（select），不再从条目中间切断；shadow 模式只记录本次会选谁、一个 prompt 字节都不改。工作区注入的目录扫描加上硬上限（根 32 / 目录 4000 / 条目 20000 / 单文件 1 MiB），一个巨型目录拖不死注入阶段。',
        en: 'An over-budget skill catalog can now pack whole entries by relevance (select) instead of cutting one mid-way, and shadow mode only records the choice without changing a single prompt byte. Workspace inject walks gain hard caps — 32 roots, 4 000 dirs, 20 000 entries, 1 MiB per file — so one huge directory can no longer stall injection.',
      },
      {
        zh: '模型选择面板从 composer 重开时沿用上一次的画面、后台软刷新，不再先闪一下加载条；点选立即回显。自动审查改为只按工具与参数的实际效果判，不采信 agent 对意图的自我描述——只读的生产查询仍算中风险，效果含糊就 fail closed。',
        en: 'Reopening the model picker from the composer keeps the last good paint and soft-refreshes instead of flashing a loading bar, and the selection echoes at once. Auto-review now judges only on what the tool and arguments actually do, never the agent’s narration of intent — a read-only production query stays medium, and ambiguous effects fail closed.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.5 接管 @latest。完整清单见 docs/releases/v0.6.5.md。',
        en: 'npm @xrkseek/harness-cli@0.6.5 now owns @latest. Full list in docs/releases/v0.6.5.md.',
      },
    ],
  },
  {
    version: '0.6.4',
    date: '2026-10-18',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '多个会话一起流式输出时，一个会话落库不再把旁边还在输出的会话一起写盘，只提交触发的那一个。',
        en: 'When several sessions stream at once, one commit no longer writes every neighbor to disk — only the session that tripped it.',
      },
      {
        zh: '一个词正好切在两块文本上时，落库后再打开库仍能搜到。「刷新列表」只核对已配置的模型，不会删掉你手填的显示名称。',
        en: 'A word split across two chunks stays findable after commit and reopen. Refresh list only checks models already configured and leaves hand-edited display names alone.',
      },
      {
        zh: '回合还在输出时换徽章或工作目录，这一轮不再被拆掉，空闲后下一次才换；同一条模型路线被多个会话同时挤满时，只有上限内的能进，其余留在原路线。',
        en: 'Changing the badge or working directory mid-turn no longer tears the turn down — the swap waits for idle. When many live sessions crowd one model route, only up to the cap get in and the rest stay put.',
      },
      {
        zh: '设置里的压缩触发比例、压缩后保留上限、额外减半次数现在真的进自动压缩；表情球在持续流式输出下每一帧都跟着转。',
        en: 'The compaction trigger ratio, post-compact recent cap, and extra halving passes from Settings now reach auto-compaction; the presence ball composes pose every frame under a live stream.',
      },
      {
        zh: "子代理被停（取消 / 接管 / 打断）时，父会话收到一条交代：谁停的、已经跑了多少步、自动发过几次「继续」、怎么接着跑；同一主线上的其它会话也会知道这轮被停。截断的回合自动续写上限提到 10、步内重试默认 30，发出去的「继续」在对话里显示成一条真实用户消息。",
        en: "When a child is stopped (cancel / takeover / interrupt), its parent gets a note: who stopped it, how far it had run, how many times it auto-sent 继续, and how to resume; other sessions on the same thread learn the turn was cut off. The auto-continue cap is 10 and the in-step retry default is 30, and each 继续 shows up as a real user message.",
      },
      {
        zh: "模型行新增可选「同时会话数」：留空用 Agent loop 的全局上限，填写则只约束这一个模型；「刷新列表」还会补上上游披露、而该行留空的能力值。",
        en: "Model rows take an optional session cap: blank uses the Agent-loop global; a value constrains just that model. Refresh list also fills capacities the provider disclosed but the row left blank.",
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.4 接管 @latest。完整清单见 docs/releases/v0.6.4.md。',
        en: 'npm @xrkseek/harness-cli@0.6.4 now owns @latest. Full list in docs/releases/v0.6.4.md.',
      },
    ],
  },
  {
    version: '0.6.3',
    date: '2026-10-17',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '免费通道即使返回 HTTP 200，只要流里带错误就会按服务端失败重试，不再当成空回复结束。压缩摘要与本步模型调用共用同一套重试。',
        en: 'A free lane that returns HTTP 200 with an error inside the stream is retried as a server failure instead of ending as an empty reply. Compaction summaries share that retry with the step’s model call.',
      },
      {
        zh: '步内重试默认次数从 5 提到 8（填 0 仍关闭）。从「获取模型」采纳带上下文窗口的新模型时，会按窗口写出软压缩预算；手填过的值再拉取不会被覆盖。',
        en: 'In-step retries default to 8 instead of 5 (0 still turns them off). Adopting a fetched model that discloses a context window fills a soft compact budget from that window; a later fetch does not overwrite a hand-tuned value.',
      },
      {
        zh: '思考流大约每 48ms 刷新一帧，正在生成的思考只排版尾部，侧栏轮次预览不再跟着每个 token 重画整页。',
        en: 'Think paints about every 48ms, a live Think body lays out only its tail, and the turn rail no longer redraws the page on every token.',
      },
      {
        zh: '点停止仍是「已停止」。会话被释放、父会话停下、安全策略中止等情况会用各自的文案，不再一律写成已停止。进行中的会话也不会因为改设置被拆掉。',
        en: 'Clicking Stop still reads Stopped. Session release, a parent stop, and a safety-policy stop each have their own line. A running session is not torn down by a settings change.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.3 接管 @latest。完整清单见 docs/releases/v0.6.3.md。',
        en: 'npm @xrkseek/harness-cli@0.6.3 now owns @latest. Full list in docs/releases/v0.6.3.md.',
      },
    ],
  },
  {
    version: '0.6.2',
    date: '2026-10-17',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '提议技能可以选落点：默认写当前工作区；也可以写到本机全局技能目录。写错参数会直接报错。要加人 / 干员仍走团队保存，和技能是两回事。',
        en: 'Skill proposals choose where to land: the current workspace by default, or your home global skills folder. Bad values error out. Adding a teammate still uses team save — separate from skills.',
      },
      {
        zh: '干员升到全局后，其它工作区里同人的旧条目会一起清掉，只留一份全局名单，列表不再被残留行盖住。',
        en: 'Promoting a teammate to global clears that id from every workspace roster, so one global home is not shadowed by leftover rows.',
      },
      {
        zh: '给子代理发跟进时默认立刻插话；想等它空闲再送，再显式选排队。对方忙时的提示也不再让人以为根本送不进去。',
        en: 'Follow-ups to a child default to immediate steer; queue is the explicit “wait until idle”. Busy-child copy no longer implies the message cannot land.',
      },
      {
        zh: '后台派出子代理后：本回合没事可做就结束等回传；只有下一步马上要用结果时，再继续等着。',
        en: 'After a background handoff: end the turn if nothing else is useful and wait for the completion notice; keep waiting only when the next step needs the answer.',
      },
      {
        zh: '修复重启后再聊把轮次从「第 1 轮」重数：现在会接着历史往下标，并与侧栏统计一致。',
        en: 'Fixed resumed sessions restarting round labels at 第 1 轮 — they now continue from history, in line with sidebar stats.',
      },
      {
        zh: '修复等子代理时工具行误显示「已中断」：等待期间保持运行中，真正停掉或整轮结束后才标中断。',
        en: 'Fixed waiting on a child looking Interrupted — the row stays running until a real stop or a closed turn.',
      },
      {
        zh: '修复多工作区下提议技能写错仓：会写到当前会话所在工作区，不再一律落到启动 Host 的那个仓。',
        en: 'Fixed multi-workspace skill proposals landing in the wrong tree — they now use the current session’s workspace.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.2 接管 @latest。完整清单见 docs/releases/v0.6.2.md。',
        en: 'npm @xrkseek/harness-cli@0.6.2 now owns @latest. Full list in docs/releases/v0.6.2.md.',
      },
    ],
  },
  {
    version: '0.6.1',
    date: '2026-10-16',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: 'xrkh tui 命令面加厚：/model /resume /details /approve /deny /whitelist /thinking /status，忙时输入自动转插话；16 色调色板尊重 NO_COLOR；未指定 --port 时自动连上最新仍存活的 Host 锁（桌面内置 Host 也能直接连）。',
        en: 'xrkh tui grows a real command surface: /model /resume /details /approve /deny /whitelist /thinking /status, and a line typed mid-turn becomes a steer. A 16-color palette honors NO_COLOR. With no --port it attaches to the newest live Host lock — including the Host embedded in Desktop.',
      },
      {
        zh: 'Desktop 接管全局 xrkh 命令：Settings → 通用一键把桌面自管 bin 目录放到用户 PATH 最前（关闭即解除），Windows 改走 .NET Environment API 读写 PATH，不再被 reg query 折行毁掉整条 Path。',
        en: 'Desktop can own the global xrkh command: a Settings → General switch puts the desktop-managed bin dir first on the user PATH (turn it off to unlink). Windows now reads and writes PATH through the .NET Environment API, so reg query line-wrapping can no longer truncate the whole value.',
      },
      {
        zh: '权限档与可写根热切换：/permission 或 Settings 改路径闸后无需重建 Agent，工具立刻按新闸解析；向阳 / IM 编排工作区的 shell 不再套 confine，与「完全访问」显示一致。',
        en: 'Permission tiers and writable roots now apply live: /permission or a Settings edit takes effect without rebuilding the agent. IM / Xiangyang orchestration sessions drop the shell confine so behavior matches the Full-access label.',
      },
      {
        zh: '会话库被占用时的报错可操作：给出锁文件路径、持有者 PID 与它是否仍存活，并提示该退出哪些 Host；持有者已死会自动清掉陈旧锁。cron 启动失败也如实抛出首个原因。',
        en: 'Session-store lock contention now names the lock file, the holder PID and whether it is alive, and tells you which Hosts to quit; a dead holder’s stale lock is cleared automatically. Cron start failures rethrow the real first cause.',
      },
      {
        zh: 'ACP 服务端补齐 session/load 与 session/cancel（通知或带 id 的请求均可中止），session/update 不再重复推送已发文本。定时任务目录上移到会话顶栏，只显示本工作区的 agent 任务。',
        en: 'The ACP server completes session/load and session/cancel (abort works as a notification or an id-bearing request), and session/update no longer re-streams text. The cron directory moves into the session header, filtered to this workspace’s agent jobs.',
      },
      {
        zh: '对话与注入打磨：回合注入片段可作为 session://capability · session://posture · session://collab-board 在注入目录读到；session.tools 显示 onModel 与渐进披露计数；侧栏悬停卡带支线与 badge；划词翻译以 toast 给出译文；图片卡不再复读模型信封文本；本地 echo 与持久化用户消息同组件，回合标签不再闪动。',
        en: 'Conversation and inject polish: turn-start fragments read as session://capability · session://posture · session://collab-board; session.tools shows onModel plus progressive-disclosure counts; the sidebar hover card carries sideline and badge; selection translate surfaces the result as a toast; the image card no longer echoes the model-facing envelope; local echo and the durable user node share one component, so round labels stop flickering.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.1 接管 @latest。完整清单见 docs/releases/v0.6.1.md。',
        en: 'npm @xrkseek/harness-cli@0.6.1 now owns @latest. Full list in docs/releases/v0.6.1.md.',
      },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-10-15',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '0.6.x 收口正式版：归档把日志从热库 sessions.db 分离到 sessions-archive.db；向阳空间（默认家）+ 奇创工具面；IM 工作区与 im_send/im_reply；奇创/IM/编码均有 workspace_*；回合开头 session_capability / session_posture。',
        en: '0.6.x closes as a formal release: archiving offloads logs from hot sessions.db into sessions-archive.db; Xiangyang default home + Qichuang surface; IM workspace with im_send/im_reply; workspace_* on Qichuang/IM/coding; turn-start session_capability / session_posture.',
      },
      {
        zh: '向阳专用 skills 扩到 7 条并分文件维护（模糊需求转化 / 无源码写插件 / 家目录配置 / 清理 / 分层记忆 / 主线支线 / 技能合并），产品正文变更即刷新落盘。',
        en: 'Seven Xiangyang-only skills now live in split source files (fuzzy-demand translation / plugins without a monorepo / home config / cleanup / layered memory / 主线·支线 / skill merge) and refresh on disk when bodies change.',
      },
      {
        zh: '权限与沙箱正交：完全访问 / 自动审查不套 shell 沙箱也不弹审批窗，残余请求直接拒绝；grep/glob 与 read_file 同一路径闸；多工作区下 bash 默认 cwd 认会话工作区。',
        en: 'Permission and sandbox are orthogonal: Full access / Auto skip shell confine and prompts (residual asks reject); grep/glob share the read_file path gate; in multi-workspace Hosts bash defaults to the session’s own workspace.',
      },
      {
        zh: 'npm @xrkseek/harness-cli@0.6.0 已接管 @latest（不再发 rc）。完整清单见 docs/releases/v0.6.0.md。',
        en: 'npm @xrkseek/harness-cli@0.6.0 now owns @latest (no more rc). Full list in docs/releases/v0.6.0.md.',
      },
    ],
  },
  {
    version: '0.6.0-rc.2',
    date: '2026-10-15',
    title: {
      zh: '版本变更公告',
      en: 'What’s new',
    },
    changes: [
      {
        zh: '修复插件页技能文档预览：读错 skill 名时不再误报「会话不存在」；附件/路径等资源缺失也不再冒充会话丢失。',
        en: 'Fixes Plugins skills catalog peek: truncated skill names no longer surface as “session not found”; attachment/path misses stop masquerading as dead sessions.',
      },
      {
        zh: 'npm 预发布 @xrkseek/harness-cli@0.6.0-rc.2（@rc）；@latest 仍为 0.5.31。完整清单见 docs/releases/v0.6.0-rc.2.md。',
        en: 'npm prerelease @xrkseek/harness-cli@0.6.0-rc.2 (@rc); @latest stays on 0.5.31. Full list in docs/releases/v0.6.0-rc.2.md.',
      },
    ],
  },
  {
    version: '0.6.0-rc.1',
    date: '2026-10-15',
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
        zh: '向阳空间（默认家）+ 奇创工具面；IM 工作区与 im_send/im_reply；奇创/IM/编码均有 workspace_*；主线做发现、thread_message 不要求挂钉；回合开头 session_capability / session_posture。',
        en: 'Xiangyang default home + Qichuang surface; IM workspace with im_send/im_reply; workspace_* on Qichuang/IM/coding; 主线 is discovery — thread_message needs no pin; turn-start session_capability / session_posture.',
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
        zh: '每模型会话上限只计进行中会话；Settings → 模型可下拉改默认模型；新建会话 inherit 失败时回落该默认（不再被历史会话误卡）。',
        en: 'Per-model session cap counts running sessions only; Settings → Models select sets the default; New Session falls back there when inherit has no source (idle history no longer blocks).',
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
