# Status（能力矩阵）

> **读者**：全员（对外说话以本页为准）

三态：**能跑 / 未稳 / 未做**。与代码对齐。基线 **v0.3.11**（奇数正式线；预览末号 **v0.2.7**；旧正式文稿 **v0.1.31**）。**本页主路径表当前均为能跑**；扩展能力节另列已补 / 暂缓（标 **未做** 不得当作已支持）。

XRK-Harness 为自研产品栈。设计吸收 Codex 与业界 agent harness 在会话、工具管道、子代理与壳交互上的长处；落点以本仓契约与代码为准。

**AI 调用链路**（maxSteps · prune/soft-compact · **request soft-budget fail-closed** · **tool-result spill（默认 64KiB）** · Face `bash`/`agent-loop`/`workspace-inject` 可调（设置 → Plugins） · reasoning passback · max-tokens keep/drop · EMPTY/未知 finish/残缺 tool · derive 跳过空 assistant · **reasoningEffort→DeepSeek thinking wire** · toolOrder · Anthropic cache · **LlmError HTTP 分类（含 gemini / openai-responses）· 步内 llm/retry（Face 可调）· TOOL_NOT_STARTED/OUTCOME_UNKNOWN/ABORTED_BEFORE_DISPATCH/`ABORTED` · isConcurrencySafe settle（只读工具已标）· tool-call stream + tool-call-chunks · concludesTurn / `extras.concludeTurn` · 取消 `AgentCancelCause` · 同轮 retry 耗尽后仍显示 turn-error · **DeepSeek vision-exp catalog** · **session-projection 状态/视图分离** · **durable workspace inject**）已跟至同基线。

## 能跑（本地 / Host 主路径）

下面这些**现在就可以正常用**（`pnpm` 装好、`xrkh serve` / harness preset；有 LLM 密钥经 **设置 → 模型 / 凭据**，或 Host/CI 用 `XRK_LLM_*` / replay）：

| 域 | 包 / 入口 | 规格 |
| --- | --- | --- |
| Kernel / Compose C0·C1·C2 | `@xrkseek/kernel` · `@xrkseek/compose`；Host 子会话 `openSubagentRealm` | [architecture](./architecture.md) · [compose](./compose.md) · [ADR-0005](./adr/0005-compose-leaf.md) |
| Session / Agent / Loop / Tools | `core-*`（`createPersistentSessionStore` SQLite + `XRK_SESSIONS_DIR`；**steer 可在 tool-step 边界 claim**；日志读面必选 `readEvents` · `SessionSeq` / `sessionEventCount`） | [session.md](./session.md) · [session-log.md](./session-log.md) · [session-delivery.md](./session-delivery.md) · [tool-pipeline.md](./tool-pipeline.md) · [tool-settlement.md](./tool-settlement.md) |
| Session 投影（状态/视图） | `@xrkseek/session-projection`；Face 默认单元 + mux / history；**`turnOutline`**（整段日志轮次阶梯）+ **`workspaceChanges`**（回合改动卡契约）+ 壳 rail / `loadThrough` | [modules/session-projection.md](./modules/session-projection.md) · [host-face.md](./host-face.md) · [protocol-events](./protocol-events.md) |
| Exec / Workspace / Policy | `exec-*`（`web_*` · `lsp` · **`terminal_*`** · Linux stdin-wait · **`ProcessSnapshot`**）· `workspace`（**durable inject** · recipes · skill · **layers**）· `policy` | [seams.md](./seams.md) · [web-tools.md](./web-tools.md) · [lsp-tools.md](./lsp-tools.md) · [pty-tools.md](./pty-tools.md) · [workspace-inject.md](./workspace-inject.md) · [skills-layers.md](./skills-layers.md) · [slash-recipes.md](./slash-recipes.md) · [policy.md](./policy.md) |
| Jobs | `job_list` / `job_output` / `job_kill` · 前台 bash **30s yield**（Settings 可调）· `pty-send` · Face settle **steer** 通知 · Host 共享 + session 隔离 · **`job.kill` / `job.background` RPC** · 壳 **停止/后台**（会话头 + 输入区 dock） | [shell-jobs.md](./shell-jobs.md) |
| 子代理委托 | 模型面 `subagent` · `list_agents` · `send_message` · `interrupt_agent`（Settings `agent-loop.maxSubagentDepth` / `maxActiveSubagents` 默认 **2/2**，上限深度 3；徽章可再收紧；系统提示 `tool:subagent`）；后台 continuable 子代理 drain idle 向父 inbox **steer** 完成通知（对标 Codex `inject_fragment_without_turn`，不受用户 queue 偏好影响）；Face `subagent.*` · Sidebar `subagents.live` / jobs | [host-face.md](./host-face.md) · [session-delivery.md](./session-delivery.md) · [profiles.md](./profiles.md) · [community-plugins.md](./community-plugins.md) |
| HTTP + Host + Face 主路径 | `server-*`（产品 boot 省略 Cordis UI/runner · HMR · native picker · `dsh-pocket`；工具卡 · `session/jobs` · standing 冷 history；`ask_user`；`settings_get`/`settings_mutate`；`/permission` · `/plan` · `/mcp` · `/status` · `/model` · `/theme` · `/skills` · `/compact` · `/export` · `/feedback` · `/auto-review`；mux/host **WS Ping 心跳** · **`FaceMuxSeq`**） | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| CLI | `@xrkseek/harness-cli`（主 bin **`xrkh`**；`web`/`serve`；**`xrkh <preset>`** ≡ `web --preset`（Host 徽章真源）；启动失败分类（Failed vs Waiting）并落盘 `~/.xrk/logs/startup-*.log`；`restart`=停本机 XRK Host；`--force` 仅杀已识别 Host；**`run`**：stdin/`-` · `--session-id` · `--json` NDJSON） | [apps/cli/README.md](../apps/cli/README.md) · [profiles](./profiles.md) · [configuration](./configuration.md) |
| LLM / Presets / SDK | `llm-*` · Registry R0+R1（openai-chat 含 OpenCode Zen/Go 与一批兼容网关 · completions 别名 · anthropic-messages · openai-responses · gemini-generate）· Face 手写 `llm-pi-ai` 路由（Custom provider）· `presets/*` · `@xrkseek/harness` | [llm-provider-registry.md](./llm-provider-registry.md) · [llm-provider-presets.md](./llm-provider-presets.md) · [profiles.md](./profiles.md) |
| MCP | `@xrkseek/mcp`（stdio/HTTP 有界重连 + SSE；有序内容投影；可选 image → AttachmentStore）；Host `XRK_MCP_*` 或 Face `mcp.servers` + `allowConnect` 文件真源热挂载（policy deny → **park**）；**HTTP 设备码 OAuth**（`auth` → Bearer · 令牌 `~/.xrk/mcp-tokens/<server>.json` · CLI `xrkh mcp login`）；Agent **`settings_get`/`settings_mutate`**（全局 `~/.xrk`，MCP 增删改与代理 env）；`/mcp` 清单；playbook **`xrk-capability-attach`**（`web`/`serve` 种子 `~/.xrk`：`skills/*` · 薄 `AGENTS.md` · `recipes/*`；不 mkdir 工作区） | [modules/mcp.md](./modules/mcp.md) · [host-face.md](./host-face.md) · [skills-layers.md](./skills-layers.md) |
| Attachment / 插件 | Face 附件；进程插件 `tools` · `prompt` · `commands` · **`host`** · **`channel`** · **`policy`** · **`llm`**；CLI 用户插件目录 + 客户端 `web/` 叠加；Host `wireComposition*` 自动接线；**社区 client** 免补 `xrk.host.json`（能力表 + `client.js` 扫描 + 约定 infer，见 [plugin-loader](./plugin-loader.md)） | [host-face.md](./host-face.md) · [plugin-loader.md](./plugin-loader.md) |
| 社区插件 Host | `extensions/dsh-compat` + bridge；Face **`contextTimeline`** / **`contextHeaders`** · **`costUsage`** · **`processChannels/list`**；IM webhook/poll（云端推送需 sidecar）· Vision 推理路由 · embedded 向量 · GenUI 库/npm/浏览器 runtime · TongFlow TS/Python；`xrkh doctor` · boot 自动接线 | [community-plugins.md](./community-plugins.md) · [ADR-0006](./adr/0006-im-long-lived-gateway.md) · [ADR-0007](./adr/0007-taskflow-external-runtime.md) |
| 产品 Web | `apps/web` + `packages/client`；dist 组装 · `@file`/`@session` · 跨会话 prepare · **轮次轨 / `turnOutline` · `loadThrough`** · Playwright **21/21**（`pnpm test:web`） | [host-face.md](./host-face.md) · [testing.md](./testing.md) · Cordis UI/runner/HMR 仅 `pnpm dev:web`；fiber 子进程为 Host 按需 fallback，不进产品 boot |

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
| `read_image` 结果 content=`[text,image]` + Face `meta` + Web 工具卡 | **能跑** |
| Host `home` + 工具行 POSIX `~` 缩写（read / read_image / Generic） | **能跑** |
| SSH 远端工作区（`XRK_SSH_HOST` + `XRK_SSH_WORKSPACE`；fs / bash / `run_code`；本地 Host） | **能跑**（Web 目录浏览走 SSH；交互式 PTY / `openPath` 关闭；见 [seams](./seams.md) · [configuration](./configuration.md)） |
| Workspace hover POSIX `~` 缩写（`hostDescription.home`；复制仍绝对路径） | **能跑** |
| `@` 目录 Tab / 行 chevron drill + 面包屑（Enter 插入 folder chip） | **能跑** |
| 任意类型文件上传 · 侧栏预览 · 可继续子代理排队/Steer/Stop · Open in · feedback | **能跑**（见主路径表与 [v0.3.11](./releases/v0.3.11.md)；`pnpm test:web` **21/21**） |
| 侧栏 Office/URL/子代理/计划预览 **契约**（protocol 载荷 · policy `host.open`/`sidebar.*`/`office.connect` · Face bridge 可选缝） | **能跑**（见 [policy](./policy.md) · `@xrkseek/protocol` `sidebar-previews`） |
| 侧栏 Host policy 闸门（`/sidebar` · `host.open`/`sidebar.embed`/`sidebar.fs`） | **能跑**（`ask`→Face 审批缝 / 无缝→`policy-ask`；见 [policy](./policy.md)） |
| `/office` `office.connect` 闸门 | **能跑**（configure/reconnect/test/remove；status 不门禁；见 [policy](./policy.md)） |
| Office/计划完整预览 UI 页签 | **能跑**（详情栏计划 / Office 页签读已有 `plan.preview` 与 `/office` status；不新增协议字段） |
| `subagents.preview` / `plan.preview` Host RPC | **能跑**（`SidebarFaceBridge` + `/sidebar/api/*`；复用 Face 投影 / 子代理链路，不复制 history） |
| Desktop 整包 | **未做**（明确暂缓；见 ADR-0008，`build:desktop` 已过、安装包未做） |

#### 底层能力差距

对照本机参考仓（Codex · Hermes-agent · deepseek-harness / 社区兼容器）梳理的**本仓底层**差距。表内状态只描述 XRK；主路径已「能跑」的会话 / 工具管道 / MCP / 计划模式 / 子代理 / CLI 等不在此重复展开。

| 能力面 | 本仓落点（摘要） | 状态 |
| --- | --- | --- |
| 回合改动卡 · 逐文件 diff | `workspace/changes` + 投影（含 Face `seq`）+ `runTurn` 自动 append；Face `changes.fileDiff`；壳 turnTail **改动卡** + 行内 hunk 审阅（`ui-deliverables`） | 契约 · 发出 · RPC · 对话卡 **能跑** |
| 侧栏 Office / URL 嵌入 / 子代理会话 / 计划预览 | protocol + policy 主体已定；`/sidebar` 门禁 + preview RPC；`/office` `office.connect` 已接线；详情栏计划 / Office 页签读已有 RPC | 闸门 · preview RPC · 预览页签 UI **能跑** |
| 侧栏 `agent-opens` / `agent-terminals` 真推送 | Host `AgentOpenRegistry` / `AgentPtyRegistry` + WS；`sidebar_open` · `terminal_*` 受 prefs 门控；`?uuid=` 附着 | **能跑**（prefs 默认关） |
| SSH 远端执行世界 | fs / bash / `run_code` + Web 目录浏览走 SSH；交互式 PTY / 本机 openPath 关闭（`remoteExecution`） | **能跑** |
| 多沙箱后端（容器隔离 · Windows 写隔离） | `createSandboxStack`：`workspace`（默认）· `docker` · `bwrap` · `windows`（Codex 式 helper 二进制；`XRK_SANDBOX_WINDOWS_HELPER` 必填，缺 helper **失败关闭**；模式 `workspace-write` / `read-only` / `danger-full-access`）；同一 `SandboxService` Definition | **能跑**（见 [sandbox](./sandbox.md)；需本机 Docker / bwrap / Windows helper） |
| Skills 安装（本地 · git） | `workspace/src/skill-install.ts`：装前 fail-closed 校验（`SKILL.md` 存在且 frontmatter 可解析 · 名称合法 · 目标不越 skills 根 · 拒绝装进自身源码树）；git 走 `clone --depth 1`（`--ref` → `--branch`）到临时暂存后发布进 `.agents/skills/<name>`，`#subdir` 从多技能仓里选一个；CLI `xrkh skill add/list/remove/path` | **能跑**（见 [skills-layers.md](./skills-layers.md)；git 需本机 `git`） |
| Policy 热重载 · YAML/TOML ruleset | JSON / YAML / TOML 同构 v1（`loadPolicyRulesetFile` 按扩展名解码 → `parsePolicyRuleset` → `composeHostPolicyEngine`；热重载共用）；无第二引擎 | JSON · YAML · TOML **能跑**（见 [policy](./policy.md)） |
| Host 侧栏 / open / Office policy 闸门 | `/sidebar`：`host.open` · `sidebar.embed` · `sidebar.fs`；`/office`：`office.connect`（mutation）；无 `XRK_POLICY_FILE` 时 Host 注入默认引擎；`kind:policy` 插件规则在刷新时并入（文件规则优先）；`ask`→Face `requestHostGate`，无缝→`policy-ask` | **能跑** |
| 交互式浏览器工具（`browser_*`） | `browser_open` / `browser_snapshot` / `browser_act`（默认 HTTP 快照 · `@eN`；`XRK_BROWSER_CDP_URL` 时走 Chrome DevTools）；`browser_vision` 截图进附件，无图形浏览器则失败 | **能跑**（见 [web-tools](./web-tools.md)） |
| Desktop 产品入口 | 默认入口仍是 `xrkh web` / CLI。Desktop 当前档是 `pnpm dev:desktop` 开发投影；`pnpm package:desktop` 拒绝产出安装包。`isDesktopProductReady()` 为 false | **未做**（ADR-0008，禁止跳到能跑） |
| Agent Teams / 协作图 | 子代理委托之上的图：`delegates` 边随 attach 写入，`peer` 边经 Sidebar `subagents.graph`；角色 `delegator` / `worker` / `observer` 由边推导、可用 `op=role` 显式覆盖；落在 `agent-team-graph.json` | **能跑** |
| 跨产品 Session Format 互通 | 角色 JSONL ↔ XRK 事件（多回合 · `tool` 调用/结果 · `importSessionInterchange` / `exportSessionInterchange`）；导入落到 `chat-import/inbox`，不写入 `sessions.db`，不是 Session Format V3（ADR-0009） | **能跑** |
| Python SDK | `sdks/python` 的 HTTP `HarnessClient`（health · sessions · admit · turn · chat · chat/stream）以及 `StdioHarnessClient`（拉起本机 `xrkh acp` 做 stdio JSON-RPC 轮次）；不是第二宿主（ADR-0001） | **能跑** |
| 插件运行时热卸载成对检查 | `reconcileManagedProcessPlugins` 返回 `pairing`（unload 与 register 成对）；`kind:host` 路由按当前注册表现场重建，不靠 `xrkh restart` | **能跑**（浏览器 client 半部仍需刷新） |
| GenUI 浏览器端 runtime bundle | `/dsh-genui/runtime.js`：DOM mount · custom elements · 可选 Host preview；库 CRUD / npm **能跑** | **能跑**（见 [community-plugins.md](./community-plugins.md)） |
| Mnemon 真记忆引擎 | 文档 CRUD **能跑**；`search` / `graph` / `bodies` 走文档 keyword + `[[wiki]]` / `#tag` 图（不是向量库） | **能跑** |
| 策展记忆 | `memory`：`{XRK_HOME}/memories` 的 `MEMORY.md` / `USER.md` 在会话开始冻进系统提示（另带策略段：跨会话事实 ≠ 会话内 `todo_write`）；工具只做 add/replace/remove；回合结束后把用户原话里的可复用笔记写入 `MEMORY.md`（不改当轮前缀）。与 Mnemon 文档库分开，不是向量库 | **能跑**（见 [curated-memory](./curated-memory.md)） |
| Auto-review 可插拔 classifier | 默认启发式；`options.classifier` 或 `XRK_AUTO_REVIEW_CLASSIFIER_URL` 可替换（失败则 ask，不是 Cordis host） | **能跑** |
| IM 厂商云端长推送 | 无 `XRK_IM_GATEWAY_*` 时本地 WS `/api/im/gateway/ws` 与 relay 收 push（同一消息库）；外连厂商仍可选 env。webhook/poll 不变 | **能跑** |
| TongFlow `/tongflow/plugins` 安装 | `POST` 调 `runPluginMutate`（`xrkh plugin add <spec>`）；已删的 `/plugins/install` 假 `accepted` 路由不恢复 | **能跑** |
| 生命周期 hooks | `kind: hooks` → `wireCompositionHooks`；shell PreToolUse（`hooks.json`）；出站生命周期 webhook（`webhooks.json` → notify-only POST，`turn/start`·`turn/end`·`tool/post`） | pre/post tool · shell pre_tool · webhook **能跑** |
| 定时任务（cron） | Host ticker + `cronjob` 工具；agent 新回合 / script / webhook·file 回投 | **能跑**（见 [cron](./cron.md)；`XRK_CRON=0` 关闭） |
| 桌面 computer-use | 具名 Provider：`memory` · `uia` · `background`（未安装助手则 unavailable）；与 `browser_*` 分开 | **能跑**（见 [computer-use](./computer-use.md)） |
| ACP 服务端 | `xrkh acp` stdio JSON-RPC（initialize · session/new · session/prompt） | **能跑**（见 [acp.md](./acp.md)） |
| 外部 Agent 运行时委托 | `subagent.runtime`：`in-process`（默认）· `acp` · `app-server` · `claude-code`；外部 one-shot 子进程，不建 Face 子会话 | **能跑**（见 [external-agent.md](./external-agent.md)；需本机二进制 / env） |
| 语音 Host | `text_to_speech` · `voice_transcribe` · `voice_session`；Provider：memory / OpenAI HTTP；mic/WebRTC 在客户端，浏览器传输 `@xrkseek/exec-voice/browser`（听写采集 + WebRTC 协商） | **能跑**（见 [voice.md](./voice.md)；需 `XRK_VOICE`） |
| 图像生成 | `image_generate`；Provider：memory / OpenAI Images；可选写入 AttachmentStore | **能跑**（见 [image-gen.md](./image-gen.md)；需 `XRK_IMAGE_GEN`） |
| 视频生成 | `video_generate`；异步作业（start → status/wait → content）；Provider：memory / OpenAI Videos | **能跑**（见 [video-gen.md](./video-gen.md)；需 `XRK_VIDEO_GEN`） |
| 回合回退 · 工作区快照 | `WorkspaceCheckpointStore`：影子 git（自己的 `--git-dir`，**永不**碰操作者 `.git`；合成提交身份）按 session seq 快照工作区；`restore` 回退内容，`prune` 才删新建文件 | **能跑**（见 [turn-rewind.md](./turn-rewind.md)；需 `git`） |
| MCP HTTP · OAuth 设备码 | `loginWithDeviceCode` + `McpDeviceTokenStore`（RFC 8628：`authorization_pending` / `slow_down` 续等，`access_denied` / `expired_token` 立即失败；原子落盘 `~/.xrk/mcp-tokens/<server>.json` · best-effort 0600 · 到期前 refresh）；端点缺失时按 RFC 9728 / RFC 8414 发现；`auth` 只挂在 HTTP transport；CLI `xrkh mcp login/status/logout/list/path` | **能跑**（见 [modules/mcp.md](./modules/mcp.md)、[configuration.md](./configuration.md)；需 IdP 支持设备码；UI 入口未做） |
| 文档抽取 | `read_file` 在 `FsService.read` 内把 PDF / DOCX / XLSX / ipynb 转成文本（扫描版 PDF 无文本层时说明，不另开工具名） | **能跑** |
| Office→PDF 转换缝 | 侧栏 `/sidebar/file?preview=pdf` 走独立 `OfficeToPdfProvider`（默认 `soffice`；未安装返回 `unavailable`）；不进 `read_file` | **能跑** |
| 会话遥测导出 | `wrapStoreForSessionTelemetry` + OTLP/HTTP logs（memory / OTEL_*）；notify-only | **能跑**（见 [session-telemetry.md](./session-telemetry.md)；需 `XRK_TELEMETRY` 或 OTLP endpoint） |

## 正式使用

| 层级 | 能做什么 | 前置 |
| --- | --- | --- |
| **A — 能用** | `npm i -g @xrkseek/harness-cli` 后 `xrkh web`/`run`，或源码 `build` + 组装壳后跑；**v0.3.11** 当前正式线（预览末号 **v0.2.7**） | Node ≥26；真模型需 brand `apiKeyEnv` 或 replay |
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

Three states: **Working / Unstable / Not done**. Aligned with code. Baseline **v0.3.11** (odd formal line; last preview **v0.2.7**; legacy formal notes **v0.1.31**). **Main-path rows on this page are Working today**; the extended-capabilities section lists filled / deferred items (**Not done** must not be treated as supported).

XRK-Harness is an independently developed stack. It absorbs strengths from Codex and peer agent harnesses in session, tool pipeline, subagent, and shell UX; contracts and code in this repo are authoritative.

**AI call path** (maxSteps · prune/soft-compact · **request soft-budget fail-closed** · **tool-result spill (default 64KiB)** · Face-tunable `bash` / `agent-loop` / `workspace-inject` (Settings → Plugins) · reasoning passback · max-tokens keep/drop · EMPTY / unknown finish / incomplete tool · derive skips empty assistant · **reasoningEffort→DeepSeek thinking wire** · toolOrder · Anthropic cache · **LlmError HTTP classification (incl. gemini / openai-responses) · in-step llm/retry (Face-tunable) · TOOL_NOT_STARTED / OUTCOME_UNKNOWN / ABORTED_BEFORE_DISPATCH / `ABORTED` · isConcurrencySafe settle (read-only tools marked) · tool-call stream + tool-call-chunks · concludesTurn / `extras.concludeTurn` · cancel `AgentCancelCause` · turn-error still shown after same-turn retry exhaustion · **DeepSeek vision-exp catalog** · **session-projection state/view split** · **durable workspace inject**) is tracked to the same baseline.

## Working (local / Host main path)

These are **ready to use now** (`pnpm` installed, `xrkh serve` / harness preset; LLM keys via **Settings → Models / Credentials**, or Host/CI `XRK_LLM_*` / replay):

| Domain | Package · entry | Spec |
| --- | --- | --- |
| Kernel / Compose C0·C1·C2 | `@xrkseek/kernel` · `@xrkseek/compose`; Host sub-session `openSubagentRealm` | [architecture](./architecture.md) · [compose](./compose.md) · [ADR-0005](./adr/0005-compose-leaf.md) |
| Session / Agent / Loop / Tools | `core-*` (`createPersistentSessionStore` SQLite + `XRK_SESSIONS_DIR`; **steer can claim at tool-step boundary**; log read surface requires `readEvents` · `SessionSeq` / `sessionEventCount`) | [session.md](./session.md) · [session-log.md](./session-log.md) · [session-delivery.md](./session-delivery.md) · [tool-pipeline.md](./tool-pipeline.md) · [tool-settlement.md](./tool-settlement.md) |
| Session projection (state/view) | `@xrkseek/session-projection`; Face default unit + mux / history; **`turnOutline`** (whole-log turn ladder) + **`workspaceChanges`** (turn file-card contract) + shell rail / `loadThrough` | [modules/session-projection.md](./modules/session-projection.md) · [host-face.md](./host-face.md) · [protocol-events](./protocol-events.md) |
| Exec / Workspace / Policy | `exec-*` (`web_*` · `lsp` · **`terminal_*`** · Linux stdin-wait · **`ProcessSnapshot`**) · `workspace` (**durable inject** · recipes · skill · **layers**) · `policy` | [seams.md](./seams.md) · [web-tools.md](./web-tools.md) · [lsp-tools.md](./lsp-tools.md) · [pty-tools.md](./pty-tools.md) · [workspace-inject.md](./workspace-inject.md) · [skills-layers.md](./skills-layers.md) · [slash-recipes.md](./slash-recipes.md) · [policy.md](./policy.md) |
| Jobs | `job_list` / `job_output` / `job_kill` · foreground bash **30s yield** (Settings) · `pty-send` · Face settle **steer** notify · Host shared + session isolation · **`job.kill` / `job.background` RPC** · shell **Stop/Background** (header + input dock) | [shell-jobs.md](./shell-jobs.md) |
| Subagent delegation | Model surface `subagent` · `list_agents` · `send_message` · `interrupt_agent` (Settings `agent-loop.maxSubagentDepth` / `maxActiveSubagents` default **2/2**, depth max 3; badges may tighten further; system prompt `tool:subagent`); background continuable subagent drain-idle **steers** completion notice to parent inbox (Codex `inject_fragment_without_turn`; epoch-scoped so quick re-wake does not duplicate/drop; not gated by user queue preference); Face `subagent.*` · Sidebar `subagents.live` / jobs | [host-face.md](./host-face.md) · [session-delivery.md](./session-delivery.md) · [profiles.md](./profiles.md) · [community-plugins.md](./community-plugins.md) |
| HTTP + Host + Face main path | `server-*` (product boot omits Cordis UI/runner · HMR · native picker · `dsh-pocket`; tool cards · `session/jobs` · standing cold history; `ask_user`; `settings_get`/`settings_mutate`; `/permission` · `/plan` · `/mcp` · `/status` · `/model` · `/theme` · `/skills` · `/compact` · `/export` · `/feedback` · `/auto-review`; mux/host **WS Ping heartbeats** · **`FaceMuxSeq`**) | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| CLI | `@xrkseek/harness-cli` (primary bin **`xrkh`**; `web`/`serve`; **`xrkh <preset>`** ≡ `web --preset` (Host badge truth); startup failures classified (Failed vs Waiting) with full log under `~/.xrk/logs/startup-*.log`; `restart` stops local XRK Host; `--force` kills only recognized Host; **`run`**: stdin/`-` · `--session-id` · `--json` NDJSON) | [apps/cli/README.md](../apps/cli/README.md) · [profiles](./profiles.md) · [configuration](./configuration.md) |
| LLM / Presets / SDK | `llm-*` · Registry R0+R1 (openai-chat incl. OpenCode Zen/Go and additional compatible gateways · completions alias · anthropic-messages · openai-responses · gemini-generate) · Face handwritten `llm-pi-ai` routes (Custom provider) · `presets/*` · `@xrkseek/harness` | [llm-provider-registry.md](./llm-provider-registry.md) · [llm-provider-presets.md](./llm-provider-presets.md) · [profiles.md](./profiles.md) |
| MCP | `@xrkseek/mcp` (stdio/HTTP bounded process reconnect + SSE; ordered content projection; optional image → AttachmentStore); Host `XRK_MCP_*` or Face `mcp.servers` + `allowConnect` file-backed hot-mount (policy deny → **park**); **HTTP device-code OAuth** (`auth` → Bearer · token at `~/.xrk/mcp-tokens/<server>.json` · CLI `xrkh mcp login`); Agent **`settings_get`/`settings_mutate`** (global `~/.xrk`, MCP CRUD + proxy env) · `/mcp` inventory; playbook **`xrk-capability-attach`** (`web`/`serve` seed `~/.xrk`: `skills/*` · thin `AGENTS.md` · `recipes/*`; no workspace mkdir) | [modules/mcp.md](./modules/mcp.md) · [host-face.md](./host-face.md) · [skills-layers.md](./skills-layers.md) |
| Attachment / plugins | Face attachments; process plugins `tools` · `prompt` · `commands` · **`host`** · **`channel`** · **`policy`** · **`llm`**; CLI user plugin dir + client `web/` overlay; Host `wireComposition*` auto-wiring; **community clients** need no `xrk.host.json` (capability table + `client.js` scan + convention infer — [plugin-loader](./plugin-loader.md)) | [host-face.md](./host-face.md) · [plugin-loader.md](./plugin-loader.md) |
| Community plugin Host | `extensions/dsh-compat` + bridge; Face **`contextTimeline`** / **`contextHeaders`** · **`costUsage`** · **`processChannels/list`**; IM webhook/poll (cloud push needs sidecar) · vision inference routes · embedded vectors · GenUI library/npm/browser runtime · TongFlow TS/Python; `xrkh doctor` · boot auto-wiring | [community-plugins.md](./community-plugins.md) · [ADR-0006](./adr/0006-im-long-lived-gateway.md) · [ADR-0007](./adr/0007-taskflow-external-runtime.md) |
| Product Web | `apps/web` + `packages/client`; dist assembly · `@file`/`@session` · cross-session prepare · **turn rail / `turnOutline` · `loadThrough`** · Playwright **21/21** (`pnpm test:web`) | [host-face.md](./host-face.md) · [testing.md](./testing.md) · Cordis UI/runner/HMR via `pnpm dev:web` only; fiber subprocess is Host on-demand fallback, not product boot |

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
| `read_image` content=`[text,image]` + Face `meta` + Web tool card | **Working** |
| Host `home` + tool-row POSIX `~` abbreviation (read / read_image / Generic) | **Working** |
| SSH remote workspace (`XRK_SSH_HOST` + `XRK_SSH_WORKSPACE`; fs / bash / `run_code`; local Host) | **Working** (Web directory browse rides SSH; interactive PTY / `openPath` off; see [seams](./seams.md) · [configuration](./configuration.md)) |
| Workspace hover POSIX `~` abbreviation (`hostDescription.home`; copy stays absolute) | **Working** |
| `@` directory Tab / row-chevron drill + breadcrumb (Enter inserts folder chip) | **Working** |
| Arbitrary file upload · sidebar preview · continuable subagent queue/Steer/Stop · Open in · feedback | **Working** (see main-path table and [v0.3.11](./releases/v0.3.11.md); `pnpm test:web` **21/21**) |
| Sidebar Office/URL/subagent/plan preview **contract** (protocol payloads · policy `host.open`/`sidebar.*`/`office.connect` · optional Face bridge seams) | **Working** (see [policy](./policy.md) · `@xrkseek/protocol` `sidebar-previews`) |
| Sidebar Host policy gates (`/sidebar` · `host.open`/`sidebar.embed`/`sidebar.fs`) | **Working** (`ask`→Face approval seam / no seam→`policy-ask`; see [policy](./policy.md)) |
| `/office` `office.connect` gate | **Working** (configure/reconnect/test/remove; status ungated; see [policy](./policy.md)) |
| Full Office/plan preview UI tabs | **Working** (details-column Plan / Office tabs read existing `plan.preview` and `/office` status; no new protocol fields) |
| `subagents.preview` / `plan.preview` Host RPC | **Working** (`SidebarFaceBridge` + `/sidebar/api/*`; reuses Face projection / subagent links — no history copy) |
| Desktop full package | **Not done** (explicitly deferred; ADR-0008 — `build:desktop` passes, installer not shipped) |

#### Underlying capability gaps

Gaps in **this repo's** underlying surface after review against local reference trees (Codex · Hermes-agent · deepseek-harness / community compat). Status describes XRK only; main-path Working items (session / tool pipeline / MCP / plan mode / subagents / CLI, …) are not repeated here.

| Surface | XRK landing (summary) | Status |
| --- | --- | --- |
| Turn changed-files card · per-file diff | `workspace/changes` + projection (Face `seq`) + `runTurn` auto-append; Face `changes.fileDiff`; shell turnTail **changed-files card** + inline hunk review (`ui-deliverables`) | Contract · emit · RPC · conversation card **Working** |
| Sidebar Office / URL embed / subagent session / plan preview | protocol + policy subjects exist; `/sidebar` gates + preview RPCs; `/office` `office.connect` wired; details-column Plan / Office tabs read existing RPCs | Gates · preview RPCs · preview tab UI **Working** |
| Sidebar `agent-opens` / `agent-terminals` real push | Host `AgentOpenRegistry` / `AgentPtyRegistry` + WS; `sidebar_open` · `terminal_*` gated by prefs; `?uuid=` attach | **Working** (prefs default off) |
| SSH remote execution world | fs / bash / `run_code` + Web directory browse ride SSH; interactive PTY / host-local openPath off (`remoteExecution`) | **Working** |
| Multi sandbox backends (containers · Windows write-isolation) | `createSandboxStack`: `workspace` (default) · `docker` · `bwrap` · `windows` (Codex-style helper binary; `XRK_SANDBOX_WINDOWS_HELPER` required, **fail-closed** when the helper is missing; modes `workspace-write` / `read-only` / `danger-full-access`); same `SandboxService` Definition | **Working** (see [sandbox](./sandbox.md); needs local Docker / bwrap / Windows helper) |
| Skills install (local · git) | `workspace/src/skill-install.ts`: fail-closed validation before writing (`SKILL.md` present and frontmatter parses · valid name · target stays inside the skills root · refuses installing into its own source tree); git uses `clone --depth 1` (`--ref` → `--branch`) staged in a temp dir then published to `.agents/skills/<name>`, `#subdir` picks one from a multi-skill repo; CLI `xrkh skill add/list/remove/path` | **Working** (see [skills-layers.md](./skills-layers.md); git needs local `git`) |
| Policy hot reload · YAML/TOML rulesets | JSON / YAML / TOML isomorphic v1 (`loadPolicyRulesetFile` decodes by extension → `parsePolicyRuleset` → `composeHostPolicyEngine`; hot reload shared); no second engine | JSON · YAML · TOML **Working** (see [policy](./policy.md)) |
| Host sidebar / open / Office policy gates | `/sidebar`: `host.open` · `sidebar.embed` · `sidebar.fs`; `/office`: `office.connect` (mutations); Host injects the default engine when no `XRK_POLICY_FILE`; `kind:policy` plugin rules merge on refresh (file rules first); `ask`→Face `requestHostGate`, no seam→`policy-ask` | **Working** |
| Interactive browser tools (`browser_*`) | `browser_open` / `browser_snapshot` / `browser_act` (HTTP snapshot by default · `@eN`; Chrome DevTools when `XRK_BROWSER_CDP_URL` is set); `browser_vision` stores a screenshot and fails when there is no graphical browser | **Working** (see [web-tools](./web-tools.md)) |
| Desktop product entry | Default entry remains `xrkh web` / CLI. Desktop's current phase is the `pnpm dev:desktop` development projection; `pnpm package:desktop` refuses to produce an installer. `isDesktopProductReady()` is false | **Not done** (ADR-0008; do not skip to Working) |
| Agent Teams / collab graph | Graph on top of subagent delegation: `delegates` edges follow attach, `peer` edges via Sidebar `subagents.graph`; roles `delegator` / `worker` / `observer` derived from edges and overridable with `op=role`; stored in `agent-team-graph.json` | **Working** |
| Cross-product Session Format interop | Role JSONL ↔ XRK events (multi-turn · `tool` call/result · `importSessionInterchange` / `exportSessionInterchange`); import lands in `chat-import/inbox`, not `sessions.db`; not Session Format V3 (ADR-0009) | **Working** |
| Python SDK | `sdks/python`: HTTP `HarnessClient` (health · sessions · admit · turn · chat · chat/stream) and `StdioHarnessClient` (spawns local `xrkh acp` for stdio JSON-RPC turns); not a second host (ADR-0001) | **Working** |
| Plugin runtime unload pairing checks | `reconcileManagedProcessPlugins` returns `pairing` (unload pairs with register); `kind:host` routes rebuild from the live registry without `xrkh restart` | **Working** (browser client half still needs a refresh) |
| GenUI browser runtime bundle | `/dsh-genui/runtime.js`: DOM mount · custom elements · optional Host preview; library CRUD / npm **Working** | **Working** (see [community-plugins.md](./community-plugins.md)) |
| Mnemon real memory engine | Document CRUD **Working**; `search` / `graph` / `bodies` run on documents (keyword + `[[wiki]]` / `#tag` graph; not a vector store) | **Working** |
| Curated memory | `memory`: `MEMORY.md` / `USER.md` under `{XRK_HOME}/memories` are frozen into the system prompt at session start (plus a policy section: cross-session facts ≠ in-session `todo_write`); the tool only add/replace/remove; after a turn, reusable notes from the user's own words are appended to `MEMORY.md` (that turn's prefix stays unchanged). Separate from the Mnemon document library; not a vector store | **Working** (see [curated-memory](./curated-memory.md)) |
| Auto-review pluggable classifier | Heuristic by default; replace with `options.classifier` or `XRK_AUTO_REVIEW_CLASSIFIER_URL` (fail closed to ask; not a Cordis host) | **Working** |
| IM vendor cloud push | Without `XRK_IM_GATEWAY_*`, local WS `/api/im/gateway/ws` and relay accept push (same message store); external vendor dial stays optional env. Webhook/poll unchanged | **Working** |
| TongFlow `/tongflow/plugins` install | `POST` calls `runPluginMutate` (`xrkh plugin add <spec>`); the deleted `/plugins/install` fake `accepted` route stays gone | **Working** |
| Lifecycle hooks | `kind: hooks` → `wireCompositionHooks`; shell PreToolUse (`hooks.json`); outbound lifecycle webhooks (`webhooks.json` → notify-only POST, `turn/start` · `turn/end` · `tool/post`) | pre/post tool · shell pre_tool · webhook **Working** |
| Scheduled tasks (cron) | Host ticker + `cronjob` tool; agent turns / scripts / webhook·file delivery | **Working** (see [cron](./cron.md); `XRK_CRON=0` disables) |
| Desktop computer-use | Named providers: `memory` · `uia` · `background` (unavailable when the helper is not installed); separate from `browser_*` | **Working** (see [computer-use](./computer-use.md)) |
| ACP server | `xrkh acp` stdio JSON-RPC (`initialize` · `session/new` · `session/prompt`) | **Working** (see [acp.md](./acp.md)) |
| External agent-runtime delegation | `subagent.runtime`: `in-process` (default) · `acp` · `app-server` · `claude-code`; external one-shot subprocess, no Face child | **Working** (see [external-agent.md](./external-agent.md); needs local binary / env) |
| Voice host | `text_to_speech` · `voice_transcribe` · `voice_session`; Providers: memory / OpenAI HTTP; mic/WebRTC on client, browser transport `@xrkseek/exec-voice/browser` (dictation capture + WebRTC negotiation) | **Working** (see [voice.md](./voice.md); needs `XRK_VOICE`) |
| Image generation | `image_generate`; Providers: memory / OpenAI Images; optional AttachmentStore persist | **Working** (see [image-gen.md](./image-gen.md); needs `XRK_IMAGE_GEN`) |
| Video generation | `video_generate`; async job lifecycle (start → status/wait → content); Providers: memory / OpenAI Videos | **Working** (see [video-gen.md](./video-gen.md); needs `XRK_VIDEO_GEN`) |
| Turn rewind · workspace snapshots | `WorkspaceCheckpointStore`: shadow git (its own `--git-dir`, **never** touches the operator's `.git`; synthetic commit identity) snapshots the worktree per session seq; `restore` reverts content, `prune` removes files added later | **Working** (see [turn-rewind.md](./turn-rewind.md); needs `git`) |
| MCP HTTP · OAuth device code | `loginWithDeviceCode` + `McpDeviceTokenStore` (RFC 8628: keeps waiting on `authorization_pending` / `slow_down`, fails immediately on `access_denied` / `expired_token`; atomic write to `~/.xrk/mcp-tokens/<server>.json` · best-effort 0600 · refresh before expiry); endpoints discovered per RFC 9728 / RFC 8414 when unknown; `auth` attaches to the HTTP transport only; CLI `xrkh mcp login/status/logout/list/path` | **Working** (see [modules/mcp.md](./modules/mcp.md) · [configuration.md](./configuration.md); needs an IdP with device-code support; no UI entry yet) |
| Document extraction | `read_file` converts PDF / DOCX / XLSX / ipynb to text inside `FsService.read` (scanned PDFs with no text layer say so; no extra tool name) | **Working** |
| Office→PDF conversion seam | Sidebar `/sidebar/file?preview=pdf` uses a separate `OfficeToPdfProvider` (default `soffice`; missing binary returns `unavailable`); not part of `read_file` | **Working** |
| Session telemetry export | `wrapStoreForSessionTelemetry` + OTLP/HTTP logs (memory / OTEL_*); notify-only | **Working** (see [session-telemetry.md](./session-telemetry.md); needs `XRK_TELEMETRY` or OTLP endpoint) |

## Formal use levels

| Level | What you can do | Prerequisites |
| --- | --- | --- |
| **A — Usable** | `npm i -g @xrkseek/harness-cli` then `xrkh web`/`run`, or source `build` + assembled shell; **v0.3.11** is the current formal release (last preview **v0.2.7**) | Node ≥26; live models need brand `apiKeyEnv` or replay |
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
