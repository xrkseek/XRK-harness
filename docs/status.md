# Status（能力矩阵）

> **读者**：全员（对外说话以本页为准）

三态：**能跑 / 未稳 / 未做**。与代码对齐。基线 **v0.4.9**（`0.4.x` 补丁线，接管 `@latest`；上一补丁 **v0.4.8**；上一正式线 **v0.3.11**；上一轮预览末号 **v0.2.7**；旧正式文稿 **v0.1.31**）。**本页主路径表当前均为能跑**；扩展能力节另列已补 / 暂缓（标 **未做** 不得当作已支持）。

XRK-Harness 为自研产品栈。设计吸收 Codex 与业界 agent harness 在会话、工具管道、子代理与壳交互上的长处；落点以本仓契约与代码为准。

**AI 调用链路**（maxSteps · prune/soft-compact · **request soft-budget fail-closed** · **tool-result spill（默认 64KiB；`@xrkseek/spill` locator · 策略/存储分离 · Status 可 `host.openPath` 打开）** · Face `bash`/`agent-loop`/`workspace-inject` 可调（设置 → Plugins） · reasoning passback · max-tokens keep/drop · EMPTY/未知 finish/残缺 tool · derive 跳过空 assistant · **reasoningEffort→DeepSeek thinking wire** · toolOrder · Anthropic cache · **LlmError HTTP 分类（含 gemini / openai-responses）· 步内 llm/retry（Face 可调）· TOOL_NOT_STARTED/OUTCOME_UNKNOWN/ABORTED_BEFORE_DISPATCH/`ABORTED` · isConcurrencySafe settle（只读工具已标）· tool-call stream + tool-call-chunks · concludesTurn / `extras.concludeTurn` · 取消 `AgentCancelCause` · 同轮 retry 耗尽后仍显示 turn-error · **DeepSeek vision-exp catalog** · **session-projection 状态/视图分离** · **durable workspace inject**）已跟至同基线。

## 能跑（本地 / Host 主路径）

下面这些**现在就可以正常用**（`pnpm` 装好、`xrkh serve` / harness preset；有 LLM 密钥经 **设置 → 模型 / 凭据**，或 Host/CI 用 `XRK_LLM_*` / replay）：

| 域 | 包 / 入口 | 规格 |
| --- | --- | --- |
| Kernel / Compose C0·C1·C2 | `@xrkseek/kernel` · `@xrkseek/compose`；Host 子会话 `openSubagentRealm` | [architecture](./architecture.md) · [compose](./compose.md) · [ADR-0005](./adr/0005-compose-leaf.md) |
| Session / Agent / Loop / Tools | `core-*`（`createPersistentSessionStore` SQLite + `XRK_SESSIONS_DIR`；**steer 可在 tool-step 边界 claim**；日志读面必选 `readEvents` · `SessionSeq` / `sessionEventCount`） | [session.md](./session.md) · [session-log.md](./session-log.md) · [session-delivery.md](./session-delivery.md) · [tool-pipeline.md](./tool-pipeline.md) · [tool-settlement.md](./tool-settlement.md) |
| Session 投影（状态/视图） | `@xrkseek/session-projection`；Face 默认单元 + mux / history；**`turnOutline`**（整段日志轮次阶梯）+ **`workspaceChanges`**（回合改动卡契约）+ 壳 rail / `loadThrough` | [modules/session-projection.md](./modules/session-projection.md) · [host-face.md](./host-face.md) · [protocol-events](./protocol-events.md) |
| Exec / Workspace / Policy | `exec-*`（`web_*` · `lsp` · **`terminal_*`** · Linux stdin-wait · **`ProcessSnapshot`**）· `workspace`（**durable inject** · recipes · skill · **layers**）· `policy` | [seams.md](./seams.md) · [web-tools.md](./web-tools.md) · [lsp-tools.md](./lsp-tools.md) · [pty-tools.md](./pty-tools.md) · [workspace-inject.md](./workspace-inject.md) · [skills-layers.md](./skills-layers.md) · [slash-recipes.md](./slash-recipes.md) · [policy.md](./policy.md) |
| Jobs | `job_list` / `job_output` / `job_kill` · 前台 bash **30s yield**（Settings 可调）· `pty-send` · Face settle **steer** 通知 · Host 共享 + session 隔离 · **`job.kill` / `job.background` RPC** · 壳 **停止/后台**（会话头 + 输入区 dock） | [shell-jobs.md](./shell-jobs.md) |
| 子代理委托 | 模型面 `subagent` · `list_agents` · `send_message` · `followup_task` · `wait_agent` · `analytics` · `interrupt_agent`（Settings `agent-loop.maxSubagentDepth` / `maxActiveSubagents` 默认 **2/2**，上限深度 3；徽章可再收紧；系统提示 `tool:subagent`）；`worktree:true` 走 **ManagedWorktreeManager**（分配/回收/owner 元数据 · Teams 绑定）；后台 continuable 子代理 drain idle 向父 inbox **steer** 完成通知；Face `subagent.*` · Sidebar `subagents.live` / jobs；壳 **Status** 栏展示配额与 `teamTasks`（含 worktree） | [host-face.md](./host-face.md) · [session-delivery.md](./session-delivery.md) · [profiles.md](./profiles.md) · [community-plugins.md](./community-plugins.md) |
| HTTP + Host + Face 主路径 | `server-*`（产品 boot 省略 Cordis UI/runner · HMR · native picker · `dsh-pocket`；工具卡 · `session/jobs` · standing 冷 history；`ask_user`；`settings_get`/`settings_mutate`；`/permission` · `/plan` · `/mcp` · `/status` · `/model` · `/theme` · `/skills` · `/compact` · `/export` · `/feedback` · `/auto-review` · `/rollback`；mux/host **WS Ping 心跳** · **`FaceMuxSeq`**） | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| CLI | `@xrkseek/harness-cli`（主 bin **`xrkh`**；`web`/`serve`；**`xrkh <preset>`** ≡ `web --preset`（Host 徽章真源）；**`xrkh tui`** 薄 Face TUI（mux stream + 工具轨 + `/status`）；启动失败分类（Failed vs Waiting）并落盘 `~/.xrk/logs/startup-*.log`；`restart`=停本机 XRK Host；`--force` 仅杀已识别 Host；**`run`**：stdin/`-` · `--session-id` · `--json` NDJSON） | [apps/cli/README.md](../apps/cli/README.md) · [profiles](./profiles.md) · [configuration](./configuration.md) · [host-face](./host-face.md) |
| LLM / Presets / SDK | `llm-*` · Registry R0+R1（openai-chat 含 OpenCode Zen/Go 与一批兼容网关 · completions 别名 · anthropic-messages · openai-responses · gemini-generate）· Face 手写 `llm-pi-ai` 路由（Custom provider）· `presets/*` · `@xrkseek/harness` | [llm-provider-registry.md](./llm-provider-registry.md) · [llm-provider-presets.md](./llm-provider-presets.md) · [profiles.md](./profiles.md) |
| MCP | `@xrkseek/mcp`（stdio/HTTP 有界重连 + SSE；有序内容投影；可选 image → AttachmentStore）；Host `XRK_MCP_*` 或 Face `mcp.servers` + `allowConnect` 文件真源热挂载（policy deny → **park**）；**HTTP 设备码 OAuth**（`auth` → Bearer · 令牌 `~/.xrk/mcp-tokens/<server>.json` · CLI `xrkh mcp login`）；Agent **`settings_get`/`settings_mutate`**（全局 `~/.xrk`，MCP 增删改与代理 env）；`/mcp` 清单；playbook **`xrk-capability-attach`**（`web`/`serve` 种子 `~/.xrk`：`skills/*` · 薄 `AGENTS.md` · `recipes/*`；不 mkdir 工作区） | [modules/mcp.md](./modules/mcp.md) · [host-face.md](./host-face.md) · [skills-layers.md](./skills-layers.md) |
| Attachment / 插件 | Face 附件；进程插件 `tools` · `prompt` · `commands` · **`host`** · **`channel`** · **`policy`** · **`llm`**；CLI 用户插件目录 + 客户端 `web/` 叠加；Host `wireComposition*` 自动接线；**社区 client** 免补 `xrk.host.json`（能力表 + `client.js` 扫描 + 约定 infer，见 [plugin-loader](./plugin-loader.md)） | [host-face.md](./host-face.md) · [plugin-loader.md](./plugin-loader.md) |
| 社区插件 Host | `extensions/dsh-compat` + bridge；Face **`contextTimeline`** / **`contextHeaders`** · **`costUsage`** · **`processChannels/list`**；IM webhook/poll · **sidecar 契约**（非厂商全矩阵）· Vision 推理路由 · embedded 向量 · GenUI 库/npm/浏览器 runtime · TongFlow TS/Python；`xrkh doctor` · boot 自动接线 | [community-plugins.md](./community-plugins.md) · [im-gateway-sidecar](./im-gateway-sidecar.md) · [ADR-0006](./adr/0006-im-long-lived-gateway.md) · [ADR-0007](./adr/0007-taskflow-external-runtime.md) |
| 产品 Web | `apps/web` + `packages/client`；dist 组装 · `@file`/`@session` · 跨会话 prepare · **轮次轨 / `turnOutline` · `loadThrough`** · **Status 栏**（`ui-plan` · Face `session.status` ≡ `/status` · **舰队健康/通道告警** · **上下文/轨迹页签** · live `contextTimeline` · **`costUsage` + billing 日趋势**）· Playwright **21/21**（`pnpm test:web`） | [host-face.md](./host-face.md) · [testing.md](./testing.md) · Cordis UI/runner/HMR 仅 `pnpm dev:web`；fiber 子进程为 Host 按需 fallback，不进产品 boot |

### AGT 通道集成

| 模式 | 说明 | 文档 |
| --- | --- | --- |
| **SDK 模块（唯一）** | AGT `callAI` / `/v1` → `@xrkseek/harness`；持久 session · OpenAI live SSE；工厂仅单次补全 | AGT `docs/harness-module-loop.md` · [integrators/agt-bridge.md](./integrators/agt-bridge.md) |

产品壳 = `apps/web` + `packages/client`；`serve` 用组装后的 dist / CLI `product-web/`。Hero 标语：**向阳而生，驭光而行**。

### 扩展能力（已补 / 暂缓）

| 项 | 状态 |
| --- | --- |
| 出站 `HTTP(S)_PROXY` / `ALL_PROXY` / `NO_PROXY` → undici 全局 dispatcher | **能跑**（Host `spawn` 安装；依赖 `undici`） |
| Skill `/` 菜单模糊子序列（对齐 commands） | **能跑** |
| `read_image` 结果 content=`[text,image]` + Face `meta` + Web 工具卡；可选 Hermes 式 `region` `[x1,y1,x2,y2]`（裁剪在 normalize 前） | **能跑** |
| Host `home` + 工具行 POSIX `~` 缩写（read / read_image / Generic） | **能跑** |
| SSH 远端工作区（Settings 通用「远程」`ssh-remote`；`XRK_SSH_HOST` CI 旁路；fs / bash / `run_code`；本地 Host） | **能跑**（改完重启；Web 目录浏览走 SSH；交互式 PTY / `openPath` 关闭；见 [seams](./seams.md) · [configuration](./configuration.md)） |
| Workspace hover POSIX `~` 缩写（`hostDescription.home`；复制仍绝对路径） | **能跑** |
| `@` 目录 Tab / 行 chevron drill + 面包屑（Enter 插入 folder chip） | **能跑** |
| Composer 富文本（Lexical） | **能跑**：`DraftEditor` + chip DecoratorNode + keymap（IME / modified-Enter 放行 / Shift+Tab=`tabBack`）+ `data-composer-composing` 占位抑制；keymap-routing · InputBar IME/placeholder/focus 测绿 |
| 提交 echo（`PendingSubmission`） | **能跑**：`beginSubmission` 同步插本地回显；ChatView / QueueDock `data-submission-echo`；同帧按 `rpcId` 与 durable user/queue 去重；折叠条保留「发送中…」 |
| 任意类型文件上传 · 侧栏预览 · 可继续子代理排队/Steer/Stop · Open in · feedback | **能跑**（见主路径表与 [v0.4.4](./releases/v0.4.4.md)；`pnpm test:web` **21/21**）；用户气泡文件卡经 `conversation.message.files` → `MessageFileCard`（块序混排；槽空时内联回退） |
| 右侧工作台（文件树 / 预览 / 终端 / 浏览器） | **能跑**：流内 `details`=Status；浮动工作台=Host `/sidebar/*` + 社区 `xrkh-better-sidebar`；首方薄壳 `@xrkseek/client-ui-workbench`（树+预览 · 会话头「文件」入口 · 有 `ctx.betterSidebar` 时让位）。**不**迁 dsh dockkit 为默认右栏（见 [sidebar-workbench](./sidebar-workbench.md)） |
| 侧栏 Office/URL/子代理/计划预览 **契约**（protocol 载荷 · policy `host.open`/`sidebar.*`/`office.connect` · Face bridge 可选缝） | **能跑**（见 [policy](./policy.md) · `@xrkseek/protocol` `sidebar-previews`） |
| 侧栏 Host policy 闸门（`/sidebar` · `host.open`/`sidebar.embed`/`sidebar.fs`） | **能跑**（`ask`→Face 审批缝 / 无缝→`policy-ask`；见 [policy](./policy.md)） |
| `/office` `office.connect` 闸门 | **能跑**（configure/reconnect/test/remove；status 不门禁；见 [policy](./policy.md)） |
| Office/计划完整预览 UI 页签 | **能跑**（详情栏计划 / Office 页签读已有 `plan.preview` 与 `/office` status；不新增协议字段） |
| `subagents.preview` / `plan.preview` Host RPC | **能跑**（`SidebarFaceBridge` + `/sidebar/api/*`；复用 Face 投影 / 子代理链路，不复制 history） |
| Desktop 整包 | **未稳**（ADR-0008：`package:desktop` 流水线 + **代码签名闸门**已开——Windows SafeNet token / macOS identity+notarize；壳侧 **检查更新 / 定时轮询 / 安装重启** 已接 electron-updater；`XRK_DESKTOP_PACKAGE=1` 产包需 optional electron-builder；`pnpm clean:desktop` 清产物；公开频道上传仍待凭据） |

#### 底层能力差距

对照本机参考仓（Codex · Hermes-agent · deepseek-harness / 社区兼容器）梳理的**本仓底层**差距。表内状态只描述 XRK；主路径已「能跑」的会话 / 工具管道 / MCP / 计划模式 / 子代理 / CLI 等不在此重复展开。

| 能力面 | 本仓落点（摘要） | 状态 |
| --- | --- | --- |
| 回合改动卡 · 逐文件 diff | `workspace/changes` + 投影（含 Face `seq`）+ `runTurn` 自动 append；Face `changes.fileDiff`；壳 turnTail **改动卡** + 行内 hunk 审阅（`ui-deliverables`） | 契约 · 发出 · RPC · 对话卡 **能跑** |
| 侧栏 Office / URL 嵌入 / 子代理会话 / 计划预览 | protocol + policy 主体已定；`/sidebar` 门禁 + preview RPC；`/office` `office.connect` 已接线；详情栏计划 / Office 页签读已有 RPC | 闸门 · preview RPC · 预览页签 UI **能跑** |
| 侧栏 `agent-opens` / `agent-terminals` 真推送 | Host `AgentOpenRegistry` / `AgentPtyRegistry` + WS；`sidebar_open` · `terminal_*` 受 prefs 门控（**设置 → 通用**）；`?uuid=` 附着 | **能跑**（prefs 默认关） |
| SSH 远端执行世界 | fs / bash / `run_code` + Web 目录浏览走 SSH；交互式 PTY / 本机 openPath 关闭；Host 启动 BatchMode 预检；`xrkh doctor` `ssh-remote` | **能跑** |
| 多沙箱后端（容器隔离 · Windows 写隔离） | `createSandboxStack`：`workspace`（默认）· `docker` · `bwrap` · `windows`（Codex 式 helper；缺 helper **失败关闭**）；`probeSandboxEnvironment` + `xrkh doctor` 报告 helper；出站 `XRK_WEB_FETCH_ALLOWLIST` 审计环 + Host logger observer + doctor 审计尾（非 MITM；execpolicy 语言后置） | **能跑**（见 [sandbox](./sandbox.md) · [web-tools](./web-tools.md)） |
| ExecEnvironment（多执行环境） | `@xrkseek/exec-environment`：`ExecEnvironmentProvider` → `ExecWorld`（`fs`+`subprocess`）；默认 `local`；HTTP serverless 样板 `createHttpExecEnvironment`；`resolveExecEnvironment` / `XRK_EXEC_ENVIRONMENT`；**Host 已接线**（SSH 优先，否则 `XRK_EXEC_ENVIRONMENT=http` 换整套 fs/subprocess）；`xrkh doctor` 探测 `/health`；**不是** sandbox confine | **能跑**（见 [sandbox](./sandbox.md) · [seams](./seams.md)） |
| 云任务 / Codex remote exec-server | 无 `cloud-tasks` 编排、无 Noise/`--remote` exec-server 注册面 | **未做**（P2 暂缓；SSH 路径已打磨优先） |
| Skills 安装（本地 · git） | `workspace/src/skill-install.ts`：装前 fail-closed 校验（`SKILL.md` 存在且 frontmatter 可解析 · 名称合法 · 目标不越 skills 根 · 拒绝装进自身源码树）；git 走 `clone --depth 1`（`--ref` → `--branch`）到临时暂存后发布进 `.agents/skills/<name>`，`#subdir` 从多技能仓里选一个；CLI `xrkh skill add/list/remove/path` | **能跑**（见 [skills-layers.md](./skills-layers.md)；git 需本机 `git`） |
| 学习环（任务后提案 skill） | `propose_skill`：草案 → Face 人确认 → `.agents/skills`；复杂回合 fragment nudge；**skill curator** 确定性归档过期工作区 skill（Host stop 调用 `runSkillCurator`；`xrkh doctor` dry-run；`.archive/`，无 aux LLM） | **能跑**（见 [skills-layers.md](./skills-layers.md)） |
| Policy 热重载 · YAML/TOML ruleset | JSON / YAML / TOML 同构 v1（`loadPolicyRulesetFile` 按扩展名解码 → `parsePolicyRuleset` → `composeHostPolicyEngine`；热重载共用）；无第二引擎 | JSON · YAML · TOML **能跑**（见 [policy](./policy.md)） |
| Host 侧栏 / open / Office policy 闸门 | `/sidebar`：`host.open` · `sidebar.embed` · `sidebar.fs`；`/office`：`office.connect`（mutation）；无 `XRK_POLICY_FILE` 时 Host 注入默认引擎；`kind:policy` 插件规则在刷新时并入（文件规则优先）；`ask`→Face `requestHostGate`，无缝→`policy-ask` | **能跑** |
| 交互式浏览器工具（`browser_*`） | `browser_open` / `browser_snapshot` / `browser_act`（默认 HTTP 快照 · `@eN`；Settings → Plugins → Browser 或 `XRK_BROWSER_CDP_URL` 时走 Chrome DevTools）；`browser_vision` 截图进附件；**`browser_vault_list` / `browser_vault_fill`**（Face 凭证不透明句柄；密钥永不进 tool result）；**会话级 runtime 共享** · `tool/result.error.code` | **能跑**（见 [web-tools](./web-tools.md)） |
| Desktop 产品入口 | 默认入口仍是 `xrkh web` / CLI。阶段 **first-wave-package**：`pnpm package:desktop` 校验/产包（**`win-x64` · `mac-arm64` · `mac-x64`**）；`pnpm upload:desktop` 校验/镜像上传更新频道；`pnpm dev:desktop` 仍为开发投影。`isDesktopProductReady()===true`；`installerShipped===true`（安装包仍非 day-1 入口） | **未稳**（ADR-0008；公开 COS HTTPS PUT / 实网签名发版仍凭据门控） |
| Agent Teams / 协作图 | 子代理委托之上的图 + **任务板**：`delegates`/`peer` 边；spawn 角色模板；`output_schema`；queue|steer；takeover；**managed worktree** 分配/回收/owner 元数据并绑定 `teamTasks.worktree*`；**`mergeIntoParent`（ff-only 合回主仓）**；Status Overview **任务板 UI**（按状态排序 · worktree · `externalResume` · 打开/暂停/恢复 · **冷恢复** · **合回主仓**→`worktree.merge`）；协作图厚化：`unlink`/`remove` · `neighbors`/`depth` · Status 节点 `activity`/`depth` · 模型面 **`team_graph`**（view/link/unlink/role/announce） | **能跑** |
| WorkflowEngine · Ralph | Cordis 抽象 `WorkflowEngine` + **`InProcessWorkflowEngine`** + **`IsolatingWorkflowEngine`**（worker 隔离；`createAgent` 回桥；**`await tools.name(args)`** 与 Code Mode 同形，经 Host Face 工具表回桥；禁 `run_code`/`workflow`/`ralph` 嵌套）；**Host 默认挂载 Isolating**（`hostPublic.workflowEngine`）；Face **`ralph`**（`maxResultChars`）；Cordis `tool-workflow` 消费方仍需组合挂载 | Face `ralph` **能跑**；Host Isolating + tools.* **能跑**；完整沙箱 Node PTC 进程隔离 **未做** |
| Code Mode / 程序内调工具 | `--presentation code`：`run_code` + `await tools.<name>(args)` 经 bridge 重入 composition pipeline（AsyncFunction）；无 bridge 仍 Worker/SSH snippet | **能跑**（实验；见 [code-mode](./code-mode.md)） |
| Guardian / context-fragments | `@xrkseek/context-fragments` 可插拔管线（`turn-start` / `user-message` / `post-tool`）+ 字符 budget；Harness 默认注册 **Guardian review** 片段（Settings `agent-loop.guardianFragments`，可关）；与 durable inject 分层；**非**完整 Guardian LLM 审阅引擎 | **能跑**（见 [context-fragments](./context-fragments.md)） |
| 压缩分阶可观测 | Soft-budget / overflow **prune→summary** 阶段折进 Status/`/status`；**策略族** `compactionStrategy`：`prune-summary` · `prune-only` · `summary-only` · `off`（软压 **与** overflow 共用）；`delivery` 暴露 turn ↔ compact 互斥 | **能跑** |
| Spill locator · 概况打开 | `@xrkseek/spill`：locator / store / policy；Status / **上下文**列出 spill 条目（name · bytes · tool · **head/tail 预览**）+「打开 spill」→ `host.openPath`；`contextTimeline` 带 `spillPath` | **能跑**（见 [tool-output-bound](./tool-output-bound.md)） |
| 成本 / 账单视图 | Status/`/status` 投影会话 **`costUsage`** + Host **cost-meter ledger**（今日/本月/累计 · `billing.dailyTrend`）+ `session.export` **`cost.json` 含同窗 `dailyTrend`** + `xrkh doctor` **`cost-ledger`** 探针；社区 `costMeter/*` 仍同源 | **能跑**（超越一体：事件→投影→账单→导出→doctor） |
| 舰队健康 / 通道告警 | Status `fleet`（health · slots · inbox · `channelAlerts` 计数）+ `channels.alerts`（bridge/stub IM，告警明细只在通道卡）；`/status` 文本同源 | **能跑** |
| 上下文浏览器 | Overview「上下文」页签：独立浏览 inject / compact / spill peek；Status 时间线仅条形图与计数（事件列表不重复） | **能跑** |
| 工作区模糊 file-search | `@xrkseek/xrk-file-reference-local`：`WorkspaceFileSearch` 模糊索引 + **gitignore（git 树内）**；Face `@file` / composer mention 共用 | **能跑** |
| Goal 自动续跑 | Face `goals/*` + `goals.json`；**round-driver**：armed 时 `turn/end` 自动 admit `<goal_round>` 直至 `complete`/`blocked`/`max-rounds`；`max-tokens` 则 disarm；模型面 `get_goal`/`update_goal`；Host 重启 disarm 须显式 resume | **能跑** |
| 本地 rollout-trace | 离线 reducer：session 事件 + subagent 边 → `spawn`/`message`/`tool` 图；Face `session.rolloutTrace`；export `trace/state.json`；Overview「轨迹」页签 viewer；**非** OTLP、**不上传** | **能跑** |
| 模型面 session 召回 | Face 工具 **`session_search` / `session_read` / `session_trace`**（cwd 权威 · FTS/扫描 · 字节预算快照 · 子代理谱系）；`@session` prepare 按 `maxReferenceBytes`（默认 64KiB）注入不可信召回 | **能跑** |
| 跨产品 Session Format 互通 | 角色 JSONL ↔ XRK 事件（`importSessionInterchange` / `exportSessionInterchange`）；`@xrkseek/session-format` 相邻迁移链（sqlite schema 0→1→2→3）+ 制品探测；导入落到 `chat-import/inbox`，**不**写入 `sessions.db`；**互通 ≠ Session Format V3**（ADR-0009，探测到外国 Format 头则拒绝） | **能跑** |
| Python SDK | `sdks/python` 的 HTTP `HarnessClient`（health · sessions · admit · turn · chat · chat/stream）以及 `StdioHarnessClient`（拉起本机 `xrkh acp` 做 stdio JSON-RPC 轮次）；不是第二宿主（ADR-0001） | **能跑** |
| 插件运行时热卸载成对检查 | `reconcileManagedProcessPlugins` 返回 `pairing`（unload 与 register 成对）；`kind:host` 路由按当前注册表现场重建，不靠 `xrkh restart` | **能跑**（浏览器 client 半部仍需刷新） |
| GenUI 浏览器端 runtime bundle | `/dsh-genui/runtime.js`：DOM mount · custom elements · 可选 Host preview；库 CRUD / npm **能跑** | **能跑**（见 [community-plugins.md](./community-plugins.md)） |
| Mnemon 真记忆引擎 | 文档 CRUD **能跑**；`search` / `graph` / `bodies` 走文档 keyword + `[[wiki]]` / `#tag` 图（不是向量库） | **能跑** |
| 策展记忆 | `memory`：`{XRK_HOME}/memories` 冻进系统提示；工具 add/replace/remove/**list**；回合后启发式笔记；会话结束 **leased Phase1** + 可选 **Phase2 LLM**（单飞 · Status `curatedMemory`）；与 Mnemon 分开 | **能跑**（见 [curated-memory](./curated-memory.md)；Settings → Plugins → 策展记忆） |
| Identity / 人格 | **保持薄**：产品只种子 `~/.xrk/AGENTS.md`；`SOUL`/`IDENTITY` 可选手写 inject；「用户是谁」真源 = 策展 `memories/USER.md`（≠ 站立 `USER.md`）；不自动种 Honcho / anonymous-user-id | **能跑**（决策已写进 [skills-layers](./skills-layers.md) · [curated-memory](./curated-memory.md) · [workspace-inject](./workspace-inject.md)） |
| MemoryProvider（可插拔策展后端） | `@xrkseek/exec-memory`：`file` 默认 · `http` · **`sqlite`**；Host / harness 经 `resolveMemoryProvider`（`XRK_MEMORY_PROVIDER`）；Phase1/2 与工具同一 store；`xrkh doctor` `memory-provider` | **能跑**（见 [curated-memory](./curated-memory.md)） |
| Auto-review 可插拔 classifier | 默认启发式；Settings 插件「高级」`auto-review` / Credentials token · 或 `options.classifier` / `XRK_AUTO_REVIEW_CLASSIFIER_URL`（失败则 ask）；`xrkh doctor` `auto-review` 探活；不是 Cordis/LLM Guardian | **能跑** |
| 向量记忆 sidecar | Embedded host + 可选 OpenAI-compatible **`XRK_MEMORY_EMBEDDINGS_URL`** / Settings `embeddingsUrl`（失败回退 local hash）；sidecar `XRK_MEMORY_EMBED_*` | **能跑** |
| IM bridge · 本地 ingress | webhook/poll/SSE · `message.send/list`；无 env 时本地 WS `/api/im/gateway/ws` + relay 写入同一消息库 | **能跑**（见 [im-gateway-sidecar](./im-gateway-sidecar.md) · [ADR-0006](./adr/0006-im-long-lived-gateway.md)） |
| IM sidecar 契约 | `@xrkseek/im-gateway-contract`：health/relay/auth/state · **`probeImGatewaySidecar`**；Host `im-gateway-sidecar.ts`；样板 `examples/mock-sidecar.mjs`（channel=`mock`）+ `extensions/example-im-mock-sidecar`；`xrkh doctor` `im-gateway` | **能跑** |
| IM 厂商原生长连接 SDK（Telegram/Discord/Slack/…） | Face 九路 id 仅为 **discover stub**（`wired=discover`；Host `imGatewayWired` 另表）；不嵌入厂商 SDK 树 | **未做** |
| TongFlow `/tongflow/plugins` 安装 | `POST` 调 `runPluginMutate`（`xrkh plugin add <spec>`）；已删的 `/plugins/install` 假 `accepted` 路由不恢复 | **能跑** |
| 生命周期 hooks | `kind: hooks` → `wireCompositionHooks`；shell `hooks.json`（Pre/PostToolUse · PermissionRequest · turn · compact · subagent；Claude/Codex 兼容）；出站 `webhooks.json` | pre/post tool · PermissionRequest · lifecycle · webhook **能跑** |
| 定时任务（cron） | Host ticker + `cronjob` 工具；agent 新回合 / script / webhook·file 回投 | **能跑**（见 [cron](./cron.md)；Settings → Plugins → Cron；`XRK_CRON` CI 旁路） |
| 桌面 computer-use | 具名 Provider：`memory` · `uia` · `background`（未安装助手则 unavailable）；与 `browser_*` 分开 | **能跑**（见 [computer-use](./computer-use.md)） |
| ACP 服务端 | `xrkh acp` stdio JSON-RPC（initialize · session/new · session/prompt） | **能跑**（见 [acp.md](./acp.md)） |
| 薄产品 TUI | `xrkh tui`：挂本机 Host Face（HTTP unary + `/api/events.mux`）；助手流式 + 工具轨 + `/status`（`session.status` / `formatSessionStatusText`）；非 Ink/第二运行时 | **能跑**（见 [apps/cli/README.md](../apps/cli/README.md) · [host-face](./host-face.md)） |
| A2A 出站 / 入站 | `@xrkseek/a2a`：出站 `a2a_discover/call/list/history`；**入站** Settings `a2a-inbound` / `XRK_A2A_INBOUND`：Agent Card + `POST /a2a` → Face 注入；`xrkh doctor` `a2a-inbound`；无 SSE/push/tasks CRUD；完整 PTC SDK **未做** | **能跑**（入站 opt-in） |
| 外部 Agent 运行时委托 | `subagent.runtime`：`in-process`（默认）· `acp` · `app-server` · `claude-code`；Settings Plugins `external-agent` 或 env；`acp`/`app-server` 支持 `run_in_background` + follow-up/interrupt；**冷 resume sidecar**（`external-agent-handles.json` · Status `ext:…/cold` · app-server `thread/resume` / ACP `session/load`）；`claude-code` 仍 one-shot print | **能跑**（见 [external-agent.md](./external-agent.md)） |
| 语音 Host | `text_to_speech` · `voice_transcribe` · `voice_session`；Provider：memory / OpenAI HTTP；Settings → Voice（缺钥 UI 告警 · `describeVoiceAccess` / doctor 同源文案）；mic/WebRTC 在客户端；**唤醒词未做** | **能跑**（见 [voice.md](./voice.md)；`XRK_VOICE` CI 旁路；唤醒后置） |
| 图像生成 | `image_generate`；Provider：memory / OpenAI / FAL（满编 catalog） / xAI / OpenRouter / DeepInfra（仅 t2i） / Krea / Meta Muse（仅 t2i）；可选 AttachmentStore；**文生图 + 图生图/编辑**（schema 按 `capabilities()`） | **能跑**（见 [image-gen.md](./image-gen.md)；Hermes 主路径矩阵） |
| 视频生成 | `video_generate`；异步作业；Provider：memory / OpenAI / FAL（满编 family） / xAI / OpenRouter / DeepInfra；**文生视频 + 图生视频/首帧**；**edit/extend**（OpenAI · xAI）+ `action=catalog` | **能跑**（见 [video-gen.md](./video-gen.md)；Hermes 主路径矩阵） |
| 视频理解 | `video_analyze`；整段视频 URL/工作区路径 → 多模态 LLM 文本分析（Hermes；**不抽帧**）；与 `browser_vision` / `video_generate` / `read_image` 分界；Provider：memory / OpenAI-compatible `video_url` | **能跑**（见 [video-analyze.md](./video-analyze.md)；Settings → Plugins → Video analyze；`XRK_VIDEO_ANALYZE` CI 旁路） |
| 回合回退 · 工作区快照 | `WorkspaceCheckpointStore`：影子 git；Host 每轮前自动 snapshot；Face `session.checkpoint.*` · `/rollback` · 消息 Restore；与 `session.fork` / fork-cut（仅血缘）分界见 [turn-rewind.md](./turn-rewind.md) | **能跑**（需 `git`；`XRK_CHECKPOINTS=0` 关闭自动快照） |
| MCP HTTP · OAuth 设备码 | `loginWithDeviceCode` + `McpDeviceTokenStore`（RFC 8628：`authorization_pending` / `slow_down` 续等，`access_denied` / `expired_token` 立即失败；原子落盘 `~/.xrk/mcp-tokens/<server>.json` · best-effort 0600 · 到期前 refresh）；端点缺失时按 RFC 9728 / RFC 8414 发现；`auth` 只挂在 HTTP transport；CLI `xrkh mcp login/status/logout/list/path`；Settings MCP 卡经 Face `mcp.oauth.login|status|logout` 同路径（pending：取消 / 复制码 / 自动打开验证页；已登录：到期与 refresh 徽标；IdP 无设备码 → 诚实错误；**auth-code+PKCE 未做**） | **能跑**（见 [modules/mcp.md](./modules/mcp.md)、[configuration.md](./configuration.md)；需 IdP 支持设备码） |
| 文档抽取 | `read_file` 在 `FsService.read` 内把 PDF / DOCX / XLSX / ipynb 转成文本（扫描版 PDF 无文本层时说明，不另开工具名） | **能跑** |
| apply_patch · managed worktree 合回 | Codex 格式 `apply_patch`（失败卡带 `meta.code`）；子代理 `worktree:true`；`mergeIntoParent` **ff-only**（冲突 retain）；Face `worktree.merge`；Status / Overview 任务行 **合回主仓** 按钮 + `worktreeLeaseStatus`（retained 文案） | **能跑** |
| Office→PDF 转换缝 | 侧栏 `/sidebar/file?preview=pdf` 走独立 `OfficeToPdfProvider`（默认 `soffice`；未安装返回 `unavailable`）；不进 `read_file` | **能跑** |
| 会话遥测导出 | `wrapStoreForSessionTelemetry` + OTLP/HTTP logs；Settings `session-telemetry`（关/memory/OTLP+endpoint）为产品真源；`XRK_TELEMETRY` 仅 CI 旁路；notify-only | **能跑**（见 [session-telemetry.md](./session-telemetry.md)） |
| 运行时 invariants | `@xrkseek/runtime-invariants` + `core-session`/`core-agent-loop` `./invariant` 伴侣；Host `XRK_INVARIANTS_FAIL_FAST=1` 包装 SessionStore fail-fast | **能跑**（默认关） |
| 密钥 / OS keyring | `@xrkseek/secrets`：`SecretStore` + memory / OS keyring（可选 `keytar`）· `redactSecrets` 统一日志脱敏；Face 默认 `.credentials.yaml`；`XRK_SECRETS_BACKEND=keyring` 双写 | **能跑**（keyring 需安装 `keytar`；见 [configuration.md](./configuration.md) · [seams.md](./seams.md)） |
| 写路径危险 pattern | harness：`createHardlineArgvPre`（policy **前** fail-closed）+ `createWritePathSecurityPre/Post`（敏感路径 deny；内容 pattern 默认结果提示） | **能跑**（见 [policy.md](./policy.md) · [security-checklist.md](./security-checklist.md)） |
| 图生图 / 图生视频 · 参考图编辑 | `image_generate` 参考图编辑 + `video_generate` 首帧 i2v / edit / extend / family catalog；**平台缝** `ToolDefinition.dynamicSchema`；**Provider 矩阵** memory · openai · fal · xai · openrouter · deepinfra · krea · meta-ai（视频至 deepinfra） | **能跑**（P0 多模态生成 + Hermes 主路径 Provider 体量） |
| 图片 token 估算 / 请求图缩放 | `@xrkseek/attachment`：`estimateImageTokens` / `requestImageTokenDimensions`（DeepSeek V41 发布算法）+ `requestImageDimensions` / `longEdgeDimensions`；soft-budget 按附件宽高计 vision token；DeepSeek 路由 `resolveDeepSeekRequestImagePolicy(model, source)` 按 token 网格投影 `maxPixels` 再经 local request-image 降质；`request-image-bound` 仍有 20MB base64 上限 | **能跑** |
| Vision region crop | `read_image.region` + `AttachmentStore.cropImageRegion`（Hermes `[x1,y1,x2,y2]`，裁剪在 admission normalize 前；本地仓 sharp；输出披露 crop offset） | **能跑** |

| 会话级模型选择持久化 | `~/.xrk/session-models.json` sidecar；`/model` 写入并 Host 重启回灌 | **能跑** |
| 模型模态声明编辑面 | `FaceModelEntry.inputModalities` + Settings 勾选；`createAdapter` 透传 catalog；Custom text-only 可拦图 | **能跑** |
| diff 审阅体量 | `DiffBlock` 统一/分栏切换 + 分栏同步滚动；文件导航仍薄（无独立 ReviewTab） | **部分**（分栏已落地） |
| 轨迹展示分级 | `ui-trajectory` compact / detailed 双档（紧凑时折叠 turn·calls；非虚构四档） | **能跑** |
| 快捷键查看 / 搜索 / 自定义 / 恢复 | `Ctrl+/`（⌘+/）ShortcutsPanel：查看 + 搜索；自定义/恢复默认后置 | **部分**（查看/搜索已落地） |
| 定时任务运行记录 | `cron/executions.jsonl` 有界账本（≤1000）+ `cronjob` action=`runs`；重启保留 | **能跑** |
| 时间上下文注入 | `XRK_TIME_CONTEXT_REFRESH_MS`（默认 60s）；follow-up 经 workspace block 刷新 | **能跑** |
| 归档筛选 / 置顶 | 侧栏视图选项三态：隐藏已归档 / 全部 / 仅已归档（`ArchiveViewMode`；cwd 回挂 Face 已剥离的 membership）；Settings 归档页仍为搜索 + Unarchive；**置顶未做** | **部分**（筛选能跑 · 置顶 P3） |
| 模型切换等待提示 | 切换模型无「准备中 · 减少等待」提示（DSH rc.2 有等待提示）；Focus 样式与语义高亮一致性未齐 | **未做**（P3：体感细节） |

### 缺口分阶段方案（对 DSH 0.1.7-rc.1/rc.2 · Hermes · Codex 参考）

- **P1 · 多模态生成打通**（对齐 Hermes `image_gen`/`video_gen`）：
  1. ~~`image_generate` 增 `reference_images`/`image_url` + `edit`~~ **已落地**（动态 schema · OpenAI edits · attachment ids）；
  2. ~~`video_generate` 增 `first_frame`/`reference_images`（i2v）+ edit/extend + family catalog~~ **已落地**；
  3. 参考图走 AttachmentStore（工具面与 `read_image`/拖拽共用 intake）— 图/视频侧均已接。
- **P2 · 成本与模态**：~~`FaceModelEntry` + Settings 模态 + 会话 `/model` 持久~~ **已落地**。
- **P2 · UI 体量**：~~diff 分栏 + 同步滚动~~ · ~~轨迹 compact/detailed~~ · ~~快捷键查看/搜索（Ctrl+/）~~ · ~~cron 跑史~~ · ~~时间注入（默认 60s）~~ **已落地**（keymap 自定义/恢复 · ReviewTab 文件导航 · hover 预览仍后置）。
- **P3 · 打磨**：~~归档筛选三态~~ **已落地**；置顶仍未做；模型切换等待提示；Focus/语义高亮一致性巡检。
- **P4 · 社区插件兼容面**（真源 `DSH_COMPAT_KNOWN_GAPS`，已诚实化）：
  1. `web-panel-global-registry`：DSH 0.1.5+ 全局面板 `sidebar.panellist` / `main` seat 落点（需产品壳 slot 扩展，非 dsh-compat 本体；当前审计面已把 panellist 标记为 `missing-seat`，社区 client 的 `slots.register` 形状会被扫描诚实暴露，不会静默假装支持）；
  2. `cordis-dual-half-inspect`：官方 `cordis_inspect_list`/`cordis_inspect_query` + mount/dispose 生命周期，按"不嵌入第三方 Host 内核"边界保持 honest-stub；
  3. `third-party-di`：全量第三方 DI 非产品目标，未知 service 引用返回诚实 envelope。

## 正式使用

| 层级 | 能做什么 | 前置 |
| --- | --- | --- |
| **A — 能用** | `npm i -g @xrkseek/harness-cli` 后 `xrkh web`/`run`，或源码 `build` + 组装壳后跑；**v0.4.9** 当前 `@latest`（上一补丁 **v0.4.8**；上一正式线 **v0.3.11**；上一轮预览末号 **v0.2.7**） | Node ≥26；真模型需 brand `apiKeyEnv` 或 replay |
| **B — 浏览器硬刷** | `pnpm test:web`（不进 `pnpm check`） | Chromium；完整 `apps/web/dist` |
| **C — 上架** | npmjs + GitHub Release（`@xrkseek/harness-cli`） | `pnpm release`；见 [publishing.md](./publishing.md) |

入门：[getting-started.md](./getting-started.md) · 配置：[configuration.md](./configuration.md) · 排障：[troubleshooting.md](./troubleshooting.md)。

## 依赖纪律

```text
apps → sdk | server | presets
presets / sdk / server → core* | llm | mcp | attachment | exec* | workspace | policy | compose
core* / 能力叶 → kernel | protocol | compose
```

产品壳：`apps/web` + `packages/client`。品牌资源：`apps/web/public`。`serve` 用 `apps/web/dist`（`web:build` + `client:bundle` + `web:assemble`；gitignore）。社区 client 经 Host 适配器 `extensions/dsh-compat` 接入（见 [community-plugins](./community-plugins.md) · [ADR-0002](./adr/0002-no-embed-upstream.md)）。

[learn.md](./learn.md) · [modules/](./modules/README.md)

---

# Status (Capability Matrix)

> **Audience**: Everyone (this page is the public capability truth)

Three states: **Working / Unstable / Not done**. Aligned with code. Baseline **v0.4.9** (`0.4.x` patch line, owning `@latest`; previous patch **v0.4.8**; previous formal line **v0.3.11**; previous preview line end **v0.2.7**; legacy formal notes **v0.1.31**). **Main-path rows on this page are Working today**; the extended-capabilities section lists filled / deferred items (**Not done** must not be treated as supported).

XRK-Harness is an independently developed stack. It absorbs strengths from Codex and peer agent harnesses in session, tool pipeline, subagent, and shell UX; contracts and code in this repo are authoritative.

**AI call path** (maxSteps · prune/soft-compact · **request soft-budget fail-closed** · **tool-result spill (default 64KiB; `@xrkseek/spill` locator · policy/storage split · Status opens via `host.openPath`)** · Face-tunable `bash` / `agent-loop` / `workspace-inject` (Settings → Plugins) · reasoning passback · max-tokens keep/drop · EMPTY / unknown finish / incomplete tool · derive skips empty assistant · **reasoningEffort→DeepSeek thinking wire** · toolOrder · Anthropic cache · **LlmError HTTP classification (incl. gemini / openai-responses) · in-step llm/retry (Face-tunable) · TOOL_NOT_STARTED / OUTCOME_UNKNOWN / ABORTED_BEFORE_DISPATCH / `ABORTED` · isConcurrencySafe settle (read-only tools marked) · tool-call stream + tool-call-chunks · concludesTurn / `extras.concludeTurn` · cancel `AgentCancelCause` · turn-error still shown after same-turn retry exhaustion · **DeepSeek vision-exp catalog** · **session-projection state/view split** · **durable workspace inject**) is tracked to the same baseline.

## Working (local / Host main path)

These are **ready to use now** (`pnpm` installed, `xrkh serve` / harness preset; LLM keys via **Settings → Models / Credentials**, or Host/CI `XRK_LLM_*` / replay):

| Domain | Package · entry | Spec |
| --- | --- | --- |
| Kernel / Compose C0·C1·C2 | `@xrkseek/kernel` · `@xrkseek/compose`; Host sub-session `openSubagentRealm` | [architecture](./architecture.md) · [compose](./compose.md) · [ADR-0005](./adr/0005-compose-leaf.md) |
| Session / Agent / Loop / Tools | `core-*` (`createPersistentSessionStore` SQLite + `XRK_SESSIONS_DIR`; **steer can claim at tool-step boundary**; log read surface requires `readEvents` · `SessionSeq` / `sessionEventCount`) | [session.md](./session.md) · [session-log.md](./session-log.md) · [session-delivery.md](./session-delivery.md) · [tool-pipeline.md](./tool-pipeline.md) · [tool-settlement.md](./tool-settlement.md) |
| Session projection (state/view) | `@xrkseek/session-projection`; Face default unit + mux / history; **`turnOutline`** (whole-log turn ladder) + **`workspaceChanges`** (turn file-card contract) + shell rail / `loadThrough` | [modules/session-projection.md](./modules/session-projection.md) · [host-face.md](./host-face.md) · [protocol-events](./protocol-events.md) |
| Exec / Workspace / Policy | `exec-*` (`web_*` · `lsp` · **`terminal_*`** · Linux stdin-wait · **`ProcessSnapshot`**) · `workspace` (**durable inject** · recipes · skill · **layers**) · `policy` | [seams.md](./seams.md) · [web-tools.md](./web-tools.md) · [lsp-tools.md](./lsp-tools.md) · [pty-tools.md](./pty-tools.md) · [workspace-inject.md](./workspace-inject.md) · [skills-layers.md](./skills-layers.md) · [slash-recipes.md](./slash-recipes.md) · [policy.md](./policy.md) |
| Jobs | `job_list` / `job_output` / `job_kill` · foreground bash **30s yield** (Settings) · `pty-send` · Face settle **steer** notify · Host shared + session isolation · **`job.kill` / `job.background` RPC** · shell **Stop/Background** (header + input dock) | [shell-jobs.md](./shell-jobs.md) |
| Subagent delegation | Model surface `subagent` · `list_agents` · `send_message` · `followup_task` · `wait_agent` · `analytics` · `interrupt_agent` (Settings `agent-loop.maxSubagentDepth` / `maxActiveSubagents` default **2/2**, depth max 3; badges may tighten further; system prompt `tool:subagent`); `worktree:true` uses **ManagedWorktreeManager** (allocate/reclaim/owner metadata · Teams bind); background continuable subagent drain-idle **steers** completion notice to parent inbox; Face `subagent.*` · Sidebar `subagents.live` / jobs; shell **Status** column shows quota and `teamTasks` (incl. worktree) | [host-face.md](./host-face.md) · [session-delivery.md](./session-delivery.md) · [profiles.md](./profiles.md) · [community-plugins.md](./community-plugins.md) |
| HTTP + Host + Face main path | `server-*` (product boot omits Cordis UI/runner · HMR · native picker · `dsh-pocket`; tool cards · `session/jobs` · standing cold history; `ask_user`; `settings_get`/`settings_mutate`; `/permission` · `/plan` · `/mcp` · `/status` · `/model` · `/theme` · `/skills` · `/compact` · `/export` · `/feedback` · `/auto-review` · `/rollback`; mux/host **WS Ping heartbeats** · **`FaceMuxSeq`**) | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| CLI | `@xrkseek/harness-cli` (primary bin **`xrkh`**; `web`/`serve`; **`xrkh <preset>`** ≡ `web --preset` (Host badge truth); **`xrkh tui`** thin Face TUI (mux stream + tool rail + `/status`); startup failures classified (Failed vs Waiting) with full log under `~/.xrk/logs/startup-*.log`; `restart` stops local XRK Host; `--force` kills only recognized Host; **`run`**: stdin/`-` · `--session-id` · `--json` NDJSON) | [apps/cli/README.md](../apps/cli/README.md) · [profiles](./profiles.md) · [configuration](./configuration.md) · [host-face](./host-face.md) |
| LLM / Presets / SDK | `llm-*` · Registry R0+R1 (openai-chat incl. OpenCode Zen/Go and additional compatible gateways · completions alias · anthropic-messages · openai-responses · gemini-generate) · Face handwritten `llm-pi-ai` routes (Custom provider) · `presets/*` · `@xrkseek/harness` | [llm-provider-registry.md](./llm-provider-registry.md) · [llm-provider-presets.md](./llm-provider-presets.md) · [profiles.md](./profiles.md) |
| MCP | `@xrkseek/mcp` (stdio/HTTP bounded process reconnect + SSE; ordered content projection; optional image → AttachmentStore); Host `XRK_MCP_*` or Face `mcp.servers` + `allowConnect` file-backed hot-mount (policy deny → **park**); **HTTP device-code OAuth** (`auth` → Bearer · token at `~/.xrk/mcp-tokens/<server>.json` · CLI `xrkh mcp login`); Agent **`settings_get`/`settings_mutate`** (global `~/.xrk`, MCP CRUD + proxy env) · `/mcp` inventory; playbook **`xrk-capability-attach`** (`web`/`serve` seed `~/.xrk`: `skills/*` · thin `AGENTS.md` · `recipes/*`; no workspace mkdir) | [modules/mcp.md](./modules/mcp.md) · [host-face.md](./host-face.md) · [skills-layers.md](./skills-layers.md) |
| Attachment / plugins | Face attachments; process plugins `tools` · `prompt` · `commands` · **`host`** · **`channel`** · **`policy`** · **`llm`**; CLI user plugin dir + client `web/` overlay; Host `wireComposition*` auto-wiring; **community clients** need no `xrk.host.json` (capability table + `client.js` scan + convention infer — [plugin-loader](./plugin-loader.md)) | [host-face.md](./host-face.md) · [plugin-loader.md](./plugin-loader.md) |
| Community plugin Host | `extensions/dsh-compat` + bridge; Face **`contextTimeline`** / **`contextHeaders`** · **`costUsage`** · **`processChannels/list`**; IM webhook/poll · **sidecar contract** (not a vendor matrix) · vision inference routes · embedded vectors · GenUI library/npm/browser runtime · TongFlow TS/Python; `xrkh doctor` · boot auto-wiring | [community-plugins.md](./community-plugins.md) · [im-gateway-sidecar](./im-gateway-sidecar.md) · [ADR-0006](./adr/0006-im-long-lived-gateway.md) · [ADR-0007](./adr/0007-taskflow-external-runtime.md) |
| Product Web | `apps/web` + `packages/client`; dist assembly · `@file`/`@session` · cross-session prepare · **turn rail / `turnOutline` · `loadThrough`** · **Status column** (`ui-plan` · Face `session.status` ≡ `/status` · **fleet health / channel alerts** · **Context / Rollout tabs** · live `contextTimeline` · **`costUsage` + billing daily trend**) · Playwright **21/21** (`pnpm test:web`) | [host-face.md](./host-face.md) · [testing.md](./testing.md) · Cordis UI/runner/HMR via `pnpm dev:web` only; fiber subprocess is Host on-demand fallback, not product boot |

### AGT channel integration

| Mode | Notes | Docs |
| --- | --- | --- |
| **SDK module (only)** | AGT `callAI` / `/v1` → `@xrkseek/harness`; durable session · OpenAI live SSE; factory is single-shot completion only | AGT `docs/harness-module-loop.md` · [integrators/agt-bridge.md](./integrators/agt-bridge.md) |

Product shell = `apps/web` + `packages/client`; `serve` uses assembled dist / CLI `product-web/`. Hero slogan: **向阳而生，驭光而行**.

### Extended capabilities (filled / deferred)

| Item | Status |
| --- | --- |
| Outbound `HTTP(S)_PROXY` / `ALL_PROXY` / `NO_PROXY` → undici global dispatcher | **Working** (Host `spawn` install; `undici` dep) |
| Skill `/` menu fuzzy subsequence (aligned with commands) | **Working** |
| `read_image` content=`[text,image]` + Face `meta` + Web tool card; optional Hermes-style `region` `[x1,y1,x2,y2]` (crop before normalize) | **Working** |
| Host `home` + tool-row POSIX `~` abbreviation (read / read_image / Generic) | **Working** |
| SSH remote workspace (Settings General → Remote `ssh-remote`; `XRK_SSH_HOST` CI bypass; fs / bash / `run_code`; local Host) | **Working** (restart after change; Web directory browse rides SSH; interactive PTY / `openPath` off; see [seams](./seams.md) · [configuration](./configuration.md)) |
| Workspace hover POSIX `~` abbreviation (`hostDescription.home`; copy stays absolute) | **Working** |
| `@` directory Tab / row-chevron drill + breadcrumb (Enter inserts folder chip) | **Working** |
| Composer rich text (Lexical) | **Working**: `DraftEditor` + chip DecoratorNode + keymap (IME / modified-Enter passthrough / Shift+Tab=`tabBack`) + `data-composer-composing` placeholder suppress; keymap-routing · InputBar IME/placeholder/focus specs green |
| Submission echo (`PendingSubmission`) | **Working**: `beginSubmission` inserts a local echo; ChatView / QueueDock `data-submission-echo`; same-render `rpcId` handoff vs durable user/queue; collapsed dock keeps “Sending…” |
| Arbitrary file upload · sidebar preview · continuable subagent queue/Steer/Stop · Open in · feedback | **Working** (see main-path table and [v0.4.4](./releases/v0.4.4.md); `pnpm test:web` **21/21**); user-bubble file cards via `conversation.message.files` → `MessageFileCard` (block order; inline fallback when the slot is empty) |
| Right workbench (tree / preview / terminal / browser) | **Working**: in-flow `details`=Status; floating workbench=Host `/sidebar/*` + community `xrkh-better-sidebar`; first-party thin shell `@xrkseek/client-ui-workbench` (tree+preview · session-header **Files** entry · yields when `ctx.betterSidebar` is set). **No** dsh dockkit as the default rightbar (see [sidebar-workbench](./sidebar-workbench.md)) |
| Sidebar Office/URL/subagent/plan preview **contract** (protocol payloads · policy `host.open`/`sidebar.*`/`office.connect` · optional Face bridge seams) | **Working** (see [policy](./policy.md) · `@xrkseek/protocol` `sidebar-previews`) |
| Sidebar Host policy gates (`/sidebar` · `host.open`/`sidebar.embed`/`sidebar.fs`) | **Working** (`ask`→Face approval seam / no seam→`policy-ask`; see [policy](./policy.md)) |
| `/office` `office.connect` gate | **Working** (configure/reconnect/test/remove; status ungated; see [policy](./policy.md)) |
| Full Office/plan preview UI tabs | **Working** (details-column Plan / Office tabs read existing `plan.preview` and `/office` status; no new protocol fields) |
| `subagents.preview` / `plan.preview` Host RPC | **Working** (`SidebarFaceBridge` + `/sidebar/api/*`; reuses Face projection / subagent links — no history copy) |
| Desktop full package | **Unstable** (ADR-0008: `package:desktop` pipeline + **code-signing gates** open — Windows SafeNet token / macOS identity+notarize; shell **check-for-updates / scheduled poll / install-restart** wired to electron-updater; `XRK_DESKTOP_PACKAGE=1` needs optional electron-builder; `pnpm clean:desktop` clears artifacts; public update upload still credential-gated) |

#### Underlying capability gaps

Gaps in **this repo's** underlying surface after review against local reference trees (Codex · Hermes-agent · deepseek-harness / community compat). Status describes XRK only; main-path Working items (session / tool pipeline / MCP / plan mode / subagents / CLI, …) are not repeated here.

| Surface | XRK landing (summary) | Status |
| --- | --- | --- |
| Turn changed-files card · per-file diff | `workspace/changes` + projection (Face `seq`) + `runTurn` auto-append; Face `changes.fileDiff`; shell turnTail **changed-files card** + inline hunk review (`ui-deliverables`) | Contract · emit · RPC · conversation card **Working** |
| Sidebar Office / URL embed / subagent session / plan preview | protocol + policy subjects exist; `/sidebar` gates + preview RPCs; `/office` `office.connect` wired; details-column Plan / Office tabs read existing RPCs | Gates · preview RPCs · preview tab UI **Working** |
| Sidebar `agent-opens` / `agent-terminals` real push | Host `AgentOpenRegistry` / `AgentPtyRegistry` + WS; `sidebar_open` · `terminal_*` gated by prefs (**Settings → General**); `?uuid=` attach | **Working** (prefs default off) |
| SSH remote execution world | fs / bash / `run_code` + Web directory browse ride SSH; interactive PTY / host-local openPath off; Host BatchMode probe on start; `xrkh doctor` `ssh-remote` | **Working** |
| Multi sandbox backends (containers · Windows write-isolation) | `createSandboxStack`: `workspace` (default) · `docker` · `bwrap` · `windows` (Codex-style helper; **fail-closed** without helper); `probeSandboxEnvironment` + `xrkh doctor` report helpers; outbound `XRK_WEB_FETCH_ALLOWLIST` audit ring + Host logger observer + doctor audit tail (not MITM; execpolicy language deferred) | **Working** (see [sandbox](./sandbox.md) · [web-tools](./web-tools.md)) |
| ExecEnvironment (pluggable exec worlds) | `@xrkseek/exec-environment`: `ExecEnvironmentProvider` → `ExecWorld` (`fs`+`subprocess`); default `local`; HTTP serverless sample `createHttpExecEnvironment`; `resolveExecEnvironment` / `XRK_EXEC_ENVIRONMENT`; **Host-wired** (SSH first, else `XRK_EXEC_ENVIRONMENT=http` swaps fs/subprocess); `xrkh doctor` probes `/health`; **not** sandbox confine | **Working** (see [sandbox](./sandbox.md) · [seams](./seams.md)) |
| Cloud tasks / Codex remote exec-server | No `cloud-tasks` orchestration, no Noise/`--remote` exec-server registry | **Not done** (P2 deferred; SSH path thickened first) |
| Skills install (local · git) | `workspace/src/skill-install.ts`: fail-closed validation before writing (`SKILL.md` present and frontmatter parses · valid name · target stays inside the skills root · refuses installing into its own source tree); git uses `clone --depth 1` (`--ref` → `--branch`) staged in a temp dir then published to `.agents/skills/<name>`, `#subdir` picks one from a multi-skill repo; CLI `xrkh skill add/list/remove/path` | **Working** (see [skills-layers.md](./skills-layers.md); git needs local `git`) |
| Learning loop (propose skill after tasks) | `propose_skill`: draft → Face confirm → `.agents/skills`; fragment nudge; **skill curator** archives stale workspace skills (Host stop calls `runSkillCurator`; `xrkh doctor` dry-run; `.archive/`; no aux LLM) | **Working** (see [skills-layers.md](./skills-layers.md)) |
| Policy hot reload · YAML/TOML rulesets | JSON / YAML / TOML isomorphic v1 (`loadPolicyRulesetFile` decodes by extension → `parsePolicyRuleset` → `composeHostPolicyEngine`; hot reload shared); no second engine | JSON · YAML · TOML **Working** (see [policy](./policy.md)) |
| Host sidebar / open / Office policy gates | `/sidebar`: `host.open` · `sidebar.embed` · `sidebar.fs`; `/office`: `office.connect` (mutations); Host injects the default engine when no `XRK_POLICY_FILE`; `kind:policy` plugin rules merge on refresh (file rules first); `ask`→Face `requestHostGate`, no seam→`policy-ask` | **Working** |
| Interactive browser tools (`browser_*`) | `browser_open` / `browser_snapshot` / `browser_act` (HTTP snapshot by default · `@eN`; Chrome DevTools via Settings → Plugins → Browser or `XRK_BROWSER_CDP_URL`); `browser_vision` stores a screenshot; **`browser_vault_list` / `browser_vault_fill`** (opaque Face credential handles; secrets never in tool results); **session-scoped runtime share** · typed `tool/result.error.code` | **Working** (see [web-tools](./web-tools.md)) |
| Desktop product entry | Default entry remains `xrkh web` / CLI. Phase **first-wave-package**: `pnpm package:desktop` validates/produces (**`win-x64` · `mac-arm64` · `mac-x64`**); `pnpm upload:desktop` validates/mirrors the update channel; `pnpm dev:desktop` remains the development projection. `isDesktopProductReady()===true`; `installerShipped===true` (installer is still not the day-1 entry) | **Unstable** (ADR-0008; live COS HTTPS PUT / signed public ship remain credential-gated) |
| Agent Teams / collab graph | Graph on top of subagent delegation **plus task board**: `delegates`/`peer` edges; spawn roles; `output_schema`; queue|steer; takeover; **managed worktree** allocate/reclaim/owner metadata bound to `teamTasks.worktree*`; **`mergeIntoParent` (ff-only fold-back)**; Status Overview **task-board UI** (status-sorted · worktree · `externalResume` · open/pause/resume · **cold resume** · **merge to parent** → `worktree.merge`); collab-graph thicken: `unlink`/`remove` · `neighbors`/`depth` · Status node `activity`/`depth` · model **`team_graph`** (view/link/unlink/role/announce) | **Working** |
| WorkflowEngine · Ralph | Cordis abstract `WorkflowEngine` + **`InProcessWorkflowEngine`** + **`IsolatingWorkflowEngine`** (worker isolation; `createAgent` bridge; **`await tools.name(args)`** Code Mode shape via Host Face tool table; blocks nested `run_code`/`workflow`/`ralph`); **Host mounts Isolating by default** (`hostPublic.workflowEngine`); Face **`ralph`** (`maxResultChars`); Cordis `tool-workflow` consumer still needs composition mount | Face `ralph` **Working**; Host Isolating + tools.* **Working**; full sandboxed Node PTC process confinement **Not done** |
| Code Mode / tools-in-code | `--presentation code`: `run_code` + `await tools.<name>(args)` re-enters the composition pipeline via bridge (AsyncFunction); without a bridge, Worker/SSH snippet only | **Working** (experimental; see [code-mode](./code-mode.md)) |
| Guardian / context-fragments | `@xrkseek/context-fragments` pluggable pipeline (`turn-start` / `user-message` / `post-tool`) + char budget; Harness registers a thin **Guardian review** fragment by default (Settings `agent-loop.guardianFragments`, can disable); layered apart from durable inject; **not** a full Guardian LLM review engine | **Working** (see [context-fragments](./context-fragments.md)) |
| Compaction stage observability | Soft-budget / overflow **prune→summary** stages fold into Status/`/status`; **strategy family** `compactionStrategy`: `prune-summary` · `prune-only` · `summary-only` · `off` (shared by soft budget **and** overflow); `delivery` exposes turn ↔ compact exclusion | **Working** |
| Spill locator · overview open | `@xrkseek/spill`: locator / store / policy; Status / **Context** list spill entries (name · bytes · tool · **head/tail preview**) + “Open spill” → `host.openPath`; `contextTimeline` carries `spillPath` | **Working** (see [tool-output-bound](./tool-output-bound.md)) |
| Cost / billing view | Status/`/status` projects session **`costUsage`** + Host **cost-meter ledger** (today/month/total · `billing.dailyTrend`) + `session.export` **`cost.json` with the same-window `dailyTrend`** + `xrkh doctor` **`cost-ledger`** probe; community `costMeter/*` stays on the same ledger | **Working** (surpass combo: events → projection → billing → export → doctor) |
| Fleet health / channel alerts | Status `fleet` (health · slots · inbox · `channelAlerts` count) + `channels.alerts` (bridge/stub IM; alert detail only on Channels card); same facts in `/status` text | **Working** |
| Context browser | Overview **Context** tab browses inject / compact / spill peek; Status timeline is bar + counts only (no duplicate event list) | **Working** |
| Workspace fuzzy file-search | `@xrkseek/xrk-file-reference-local`: `WorkspaceFileSearch` fuzzy index + **gitignore (inside git trees)**; Face `@file` / composer mentions share it | **Working** |
| Goal auto-continue | Face `goals/*` + `goals.json`; **round-driver**: while armed, `turn/end` auto-admits `<goal_round>` until `complete`/`blocked`/`max-rounds`; `max-tokens` disarms; model tools `get_goal`/`update_goal`; Host restart disarms until explicit resume | **Working** |
| Local rollout-trace | Offline reducer: session events + subagent links → `spawn`/`message`/`tool` graph; Face `session.rolloutTrace`; export `trace/state.json`; Overview **Rollout** viewer tab; **not** OTLP, **no upload** | **Working** |
| Model-facing session recall | Face tools **`session_search` / `session_read` / `session_trace`** (cwd authority · FTS/scan · byte-budget snapshot · subagent lineage); `@session` prepare injects untrusted recall under `maxReferenceBytes` (default 64KiB) | **Working** |
| Cross-product Session Format interop | Role JSONL ↔ XRK events (`importSessionInterchange` / `exportSessionInterchange`); `@xrkseek/session-format` adjacent migration chain (sqlite schema 0→1→2→3) + artifact detect; import lands in `chat-import/inbox`, **not** `sessions.db`; **interop ≠ Session Format V3** (ADR-0009 — foreign Format headers refused) | **Working** |
| Python SDK | `sdks/python`: HTTP `HarnessClient` (health · sessions · admit · turn · chat · chat/stream) and `StdioHarnessClient` (spawns local `xrkh acp` for stdio JSON-RPC turns); not a second host (ADR-0001) | **Working** |
| Plugin runtime unload pairing checks | `reconcileManagedProcessPlugins` returns `pairing` (unload pairs with register); `kind:host` routes rebuild from the live registry without `xrkh restart` | **Working** (browser client half still needs a refresh) |
| GenUI browser runtime bundle | `/dsh-genui/runtime.js`: DOM mount · custom elements · optional Host preview; library CRUD / npm **Working** | **Working** (see [community-plugins.md](./community-plugins.md)) |
| Mnemon real memory engine | Document CRUD **Working**; `search` / `graph` / `bodies` run on documents (keyword + `[[wiki]]` / `#tag` graph; not a vector store) | **Working** |
| Curated memory | `memory`: frozen `MEMORY.md` / `USER.md`; tool add/replace/remove/**list**; after-turn heuristics; session-end **leased Phase1** + optional **Phase2 LLM** (single-flight · Status `curatedMemory`). Separate from Mnemon | **Working** (see [curated-memory](./curated-memory.md); Settings → Plugins → Curated memory) |
| Identity / persona | **Stay thin**: product seeds only `~/.xrk/AGENTS.md`; optional hand-written `SOUL`/`IDENTITY` inject; factual “who the user is” = curated `memories/USER.md` (≠ standing `USER.md`); no auto-seeded Honcho / anonymous-user-id | **Working** (decision in [skills-layers](./skills-layers.md) · [curated-memory](./curated-memory.md) · [workspace-inject](./workspace-inject.md)) |
| MemoryProvider (pluggable curated backend) | `@xrkseek/exec-memory`: `file` default · `http` · **`sqlite`**; Host / harness via `resolveMemoryProvider` (`XRK_MEMORY_PROVIDER`); Phase1/2 + tools share one store; `xrkh doctor` `memory-provider` | **Working** (see [curated-memory](./curated-memory.md)) |
| Auto-review pluggable classifier | Heuristic by default; Settings Plugins → Advanced `auto-review` / Credentials token · or `options.classifier` / `XRK_AUTO_REVIEW_CLASSIFIER_URL` (fail closed to ask); `xrkh doctor` `auto-review` probe; not a Cordis/LLM Guardian | **Working** |
| Memory embed sidecar | Embedded host + optional OpenAI-compatible **`XRK_MEMORY_EMBEDDINGS_URL`** / Settings `embeddingsUrl` (hash fallback); sidecar `XRK_MEMORY_EMBED_*` | **Working** |
| IM bridge · local ingress | webhook/poll/SSE · `message.send/list`; without env, local WS `/api/im/gateway/ws` + relay write the same message store | **Working** (see [im-gateway-sidecar](./im-gateway-sidecar.md) · [ADR-0006](./adr/0006-im-long-lived-gateway.md)) |
| IM sidecar contract | `@xrkseek/im-gateway-contract`: health/relay/auth/state · **`probeImGatewaySidecar`**; Host `im-gateway-sidecar.ts`; sample `examples/mock-sidecar.mjs` (`channel=mock`) + `extensions/example-im-mock-sidecar`; `xrkh doctor` `im-gateway` | **Working** |
| IM vendor-native long-lived SDKs (Telegram/Discord/Slack/…) | Face nine channel ids are **discover stubs** only (`wired=discover`; Host `imGatewayWired` separate); no vendor SDK tree in-host | **Not done** |
| TongFlow `/tongflow/plugins` install | `POST` calls `runPluginMutate` (`xrkh plugin add <spec>`); the deleted `/plugins/install` fake `accepted` route stays gone | **Working** |
| Lifecycle hooks | `kind: hooks` → `wireCompositionHooks`; shell `hooks.json` (Pre/PostToolUse · PermissionRequest · turn · compact · subagent; Claude/Codex-compatible); outbound `webhooks.json` | pre/post tool · PermissionRequest · lifecycle · webhook **Working** |
| Scheduled tasks (cron) | Host ticker + `cronjob` tool; agent turns / scripts / webhook·file delivery | **Working** (see [cron](./cron.md); Settings → Plugins → Cron; `XRK_CRON` CI bypass) |
| Desktop computer-use | Named providers: `memory` · `uia` · `background` (unavailable when the helper is not installed); separate from `browser_*` | **Working** (see [computer-use](./computer-use.md)) |
| ACP server | `xrkh acp` stdio JSON-RPC (`initialize` · `session/new` · `session/prompt`) | **Working** (see [acp.md](./acp.md)) |
| Thin product TUI | `xrkh tui`: attaches to a local Host Face (HTTP unary + `/api/events.mux`); assistant stream + tool rail + `/status` (`session.status` / `formatSessionStatusText`); not Ink / not a second runtime | **Working** (see [apps/cli/README.md](../apps/cli/README.md) · [host-face](./host-face.md)) |
| A2A outbound / inbound | `@xrkseek/a2a`: outbound `a2a_discover/call/list/history`; **inbound** Settings `a2a-inbound` / `XRK_A2A_INBOUND`: Agent Card + `POST /a2a` → Face inject; `xrkh doctor` `a2a-inbound`; no SSE/push/tasks CRUD; full PTC SDK **Not done** | **Working** (inbound opt-in) |
| External agent-runtime delegation | `subagent.runtime`: `in-process` (default) · `acp` · `app-server` · `claude-code`; Settings Plugins `external-agent` or env; `acp`/`app-server` support `run_in_background` + follow-up/interrupt; **cold resume sidecar** (`external-agent-handles.json` · Status `ext:…/cold` · app-server `thread/resume` / ACP `session/load`); `claude-code` remains one-shot print | **Working** (see [external-agent.md](./external-agent.md)) |
| Voice host | `text_to_speech` · `voice_transcribe` · `voice_session`; Providers: memory / OpenAI HTTP; Settings → Voice (missing-key UI warning · shared `describeVoiceAccess` / doctor copy); mic/WebRTC on client; **wake word not shipped** | **Working** (see [voice.md](./voice.md); `XRK_VOICE` CI bypass; wake deferred) |
| Image generation | `image_generate`; Providers: memory / OpenAI / FAL (full catalog) / xAI / OpenRouter / DeepInfra (t2i-only) / Krea / Meta Muse (t2i-only); optional AttachmentStore; **text-to-image + image edit** (schema from `capabilities()`) | **Working** (see [image-gen.md](./image-gen.md); Hermes main-path matrix) |
| Video generation | `video_generate`; async job lifecycle; Providers: memory / OpenAI / FAL (full families) / xAI / OpenRouter / DeepInfra; **text-to-video + image-to-video / first frame**; **edit/extend** (OpenAI · xAI) + `action=catalog` | **Working** (see [video-gen.md](./video-gen.md); Hermes main-path matrix) |
| Video analysis | `video_analyze`; whole-clip URL/workspace path → multimodal LLM text (Hermes; **no frame extract**); distinct from `browser_vision` / `video_generate` / `read_image`; Providers: memory / OpenAI-compatible `video_url` | **Working** (see [video-analyze.md](./video-analyze.md); Settings → Plugins → Video analyze; `XRK_VIDEO_ANALYZE` CI bypass) |
| Turn rewind · workspace snapshots | `WorkspaceCheckpointStore`: shadow git; Host auto-snapshots before each turn; Face `session.checkpoint.*` · `/rollback` · message Restore; distinct from `session.fork` / fork-cut (lineage only) — see [turn-rewind.md](./turn-rewind.md) | **Working** (needs `git`; `XRK_CHECKPOINTS=0` disables auto-snapshot) |
| MCP HTTP · OAuth device code | `loginWithDeviceCode` + `McpDeviceTokenStore` (RFC 8628: keeps waiting on `authorization_pending` / `slow_down`, fails immediately on `access_denied` / `expired_token`; atomic write to `~/.xrk/mcp-tokens/<server>.json` · best-effort 0600 · refresh before expiry); endpoints discovered per RFC 9728 / RFC 8414 when unknown; `auth` attaches to the HTTP transport only; CLI `xrkh mcp login/status/logout/list/path`; Settings MCP card uses Face `mcp.oauth.login|status|logout` on the same path (pending: cancel / copy code / auto-open verify URI; signed-in: expiry + refresh badge; IdP without device code → honest error; **auth-code+PKCE not done**) | **Working** (see [modules/mcp.md](./modules/mcp.md) · [configuration.md](./configuration.md); needs an IdP with device-code support) |
| Document extraction | `read_file` converts PDF / DOCX / XLSX / ipynb to text inside `FsService.read` (scanned PDFs with no text layer say so; no extra tool name) | **Working** |
| apply_patch · managed worktree fold-back | Codex-format `apply_patch` (failure card with `meta.code`); subagent `worktree:true`; `mergeIntoParent` **ff-only** (retain on conflict); Face `worktree.merge`; Status / Overview task-row **Merge to parent** + `worktreeLeaseStatus` (retained copy) | **Working** |
| Office→PDF conversion seam | Sidebar `/sidebar/file?preview=pdf` uses a separate `OfficeToPdfProvider` (default `soffice`; missing binary returns `unavailable`); not part of `read_file` | **Working** |
| Session telemetry export | `wrapStoreForSessionTelemetry` + OTLP/HTTP logs; Settings `session-telemetry` (off/memory/OTLP+endpoint) is product SoT; `XRK_TELEMETRY` is CI bypass only; notify-only | **Working** (see [session-telemetry.md](./session-telemetry.md)) |
| Runtime invariants | `@xrkseek/runtime-invariants` + `core-session`/`core-agent-loop` `./invariant` companions; Host `XRK_INVARIANTS_FAIL_FAST=1` wraps SessionStore fail-fast | **Working** (off by default) |
| Secrets / OS keyring | `@xrkseek/secrets`: `SecretStore` + memory / OS keyring (optional `keytar`) · unified `redactSecrets` for logs; Face default `.credentials.yaml`; `XRK_SECRETS_BACKEND=keyring` dual-writes | **Working** (keyring needs `keytar`; see [configuration.md](./configuration.md) · [seams.md](./seams.md)) |
| Write-path dangerous patterns | harness: `createHardlineArgvPre` (**before** policy, fail-closed) + `createWritePathSecurityPre/Post` (sensitive-path deny; content patterns advisory by default) | **Working** (see [policy.md](./policy.md) · [security-checklist.md](./security-checklist.md)) |
| Image-to-image / image-to-video · reference-image editing | `image_generate` reference edit + `video_generate` first-frame i2v / edit / extend / family catalog; **platform seam** `ToolDefinition.dynamicSchema`; **Provider matrix** memory · openai · fal · xai · openrouter · deepinfra · krea · meta-ai (video through deepinfra) | **Working** (P0 multimodal generation + Hermes main-path Provider volume) |
| Image token estimation / request-image resizing | `@xrkseek/attachment`: `estimateImageTokens` / `requestImageTokenDimensions` (DeepSeek V41 published calculator) + `requestImageDimensions` / `longEdgeDimensions`; soft-budget prices vision tokens from attachment dims; DeepSeek route `resolveDeepSeekRequestImagePolicy(model, source)` projects `maxPixels` from the token grid then local request-image downscales; `request-image-bound` keeps the 20 MB base64 safety net | **Working** |
| Vision region crop | `read_image.region` + `AttachmentStore.cropImageRegion` (Hermes `[x1,y1,x2,y2]`, crop before admission normalize; local store via sharp; tool text discloses crop offset) | **Working** |

| Session-level model selection persistence | `~/.xrk/session-models.json` sidecar; `/model` writes and Host restart rehydrates | **Working** |
| Model modality declaration editing surface | `FaceModelEntry.inputModalities` + Settings checkboxes; `createAdapter` passes catalog through; custom text-only can block images | **Working** |
| Diff review surface | `DiffBlock` unified/split toggle + synchronized scroll; file navigation still thin (no standalone ReviewTab) | **Partial** (split landed) |
| Trajectory display levels | `ui-trajectory` compact / detailed (compact folds turns·calls; not a fictional four-level) | **Working** |
| Keyboard-shortcut view / search / customize / reset | `Ctrl+/` (⌘+/) ShortcutsPanel: view + search; customize/reset deferred | **Partial** (view/search landed) |
| Scheduled-task run history | `cron/executions.jsonl` bounded ledger (≤1000) + `cronjob` action=`runs`; survives restart | **Working** |
| Time-context injection | `XRK_TIME_CONTEXT_REFRESH_MS` (default 60s); follow-ups refresh via workspace block | **Working** |
| Archive filter / pin | Sidebar view-options tri-state: hide archived / all / archived-only (`ArchiveViewMode`; cwd reattach when Face strips membership); Settings archive page remains search + Unarchive; **pin not done** | **Partial** (filter Working · pin P3) |
| Model-switch waiting hint | no "preparing · reduced wait" hint when switching models (DSH rc.2 shows one); focus style and semantic-highlight consistency unfinished | **Not done** (P3: feel-level details) |

### Gap roadmap (vs DSH 0.1.7-rc.1/rc.2 · Hermes · Codex references)

- **P1 · Multimodal generation wiring** (aligns Hermes `image_gen`/`video_gen`):
  1. ~~`image_generate` refs + edit~~ **landed** (dynamic schema · OpenAI edits · attachment ids);
  2. ~~`video_generate` first_frame / refs (i2v) + edit/extend + family catalog~~ **landed**;
  3. AttachmentStore intake shared with `read_image`/drag — image and video sides done.
- **P2 · Cost & modality**: ~~`FaceModelEntry` + Settings modalities + session `/model` persist~~ **landed**.
- **P2 · UI density**: ~~side-by-side diff + sync scroll~~ · ~~trajectory compact/detailed~~ · ~~shortcut view/search (Ctrl+/)~~ · ~~cron run history~~ · ~~time-context (default 60s)~~ **landed** (customize/reset keymap · ReviewTab file nav · hover preview still deferred).
- **P3 · Polish**: ~~archive filter tri-state~~ **landed**; pin still open; model-switch waiting hint; focus / semantic-highlight consistency pass.
- **P4 · Community-plugin compatibility surface** (truth source `DSH_COMPAT_KNOWN_GAPS`, now honest):
  1. `web-panel-global-registry`: DSH 0.1.5+ global panels `sidebar.panellist` / `main` need a product-shell seat (a shell slot extension, not dsh-compat itself); the audit surface already marks panellist `missing-seat`, so community `slots.register` shapes are surfaced honestly instead of silently claimed;
  2. `cordis-dual-half-inspect`: official `cordis_inspect_list` / `cordis_inspect_query` + mount/dispose lifecycle stays honest-stub under the "no third-party Host kernel embedding" boundary;
  3. `third-party-di`: full third-party DI is not a product goal; unknown service references get an honest envelope.

## Formal use levels

| Level | What you can do | Prerequisites |
| --- | --- | --- |
| **A — Usable** | `npm i -g @xrkseek/harness-cli` then `xrkh web`/`run`, or source `build` + assembled shell; **v0.4.9** is the current `@latest` (previous patch **v0.4.8**; previous formal line **v0.3.11**; previous preview line end **v0.2.7**) | Node ≥26; live models need brand `apiKeyEnv` or replay |
| **B — Browser soak** | `pnpm test:web` (not part of `pnpm check`) | Chromium; full `apps/web/dist` |
| **C — Publish** | npmjs + GitHub Release (`@xrkseek/harness-cli`) | `pnpm release`; see [publishing.md](./publishing.md) |

Getting started: [getting-started.md](./getting-started.md) · Configuration: [configuration.md](./configuration.md) · Troubleshooting: [troubleshooting.md](./troubleshooting.md).

## Dependency discipline

```text
apps → sdk | server | presets
presets / sdk / server → core* | llm | mcp | attachment | exec* | workspace | policy | compose
core* / capability leaves → kernel | protocol | compose
```

Product shell: `apps/web` + `packages/client`. Brand assets: `apps/web/public`. `serve` uses `apps/web/dist` (`web:build` + `client:bundle` + `web:assemble`; gitignored). Community clients attach via Host adapter `extensions/dsh-compat` ([community-plugins](./community-plugins.md) · [ADR-0002](./adr/0002-no-embed-upstream.md)).

[learn.md](./learn.md) · [modules/](./modules/README.md)
