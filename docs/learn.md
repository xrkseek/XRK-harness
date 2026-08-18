# Learn

本仓已落地的要点（规格与代码为准；不列未实现路线）。

- **Session 事件为对话真源**：模型可见输入可从事件日志重建；turn / loop 短寿
- **Session 仓**：`createJsonlSessionStore`；Host 无 `XRK_SESSIONS_DIR` 时内存。CLI `serve`/`web` 默认 `{workspace}/.xrk/sessions`（`--no-persist` 关）。每会话 `{id}.jsonl`；旁路 `subagents.json` · `goals.json`。hydrate 丢掉末行不完整 JSON **或** 末行 schema 失败并原子回写；单文件中段损坏跳过该会话。`SessionStore.has`
- **工具瀑布**：pre → guards → execute → post → finalize → settle；无全局 proxy
- **能力缝**：Definition / Provider / Consumer
- **Host Face**：Unary RPC + mux/host 双流；未实现方法 `not-implemented`
- **Host 流**：`host/session-added` 对齐 DSH `sessionListFields`（子会话 `parentSessionId` + `origin: "subagent"`；`blank` = 无 `turn/start`）。`workspace.delete` → `host/workspace-removed`；`insertBefore` → `host/workspace-order-changed`。无 dispose，不发 `host/session-removed`
- **组合叶**：`@xrkseek/compose` C0·C1·C2（`interceptInject` / `openSubagentRealm`）能跑；presets 只接线
- **Subagent**：Face `list/history/prompt/interrupt` 能跑；`session.create({ parentSessionId })` 或 `session.fork` 登记子会话。Host agent-cache 对有父的会话走 `openSubagentRealm`（无 ACP / Cordis 外挂）
- **进程插件**：`tools` · `prompt` · `commands` 已接线；`channel` / `policy` / `llm` 可发现、未自动接线；DSH Cordis 宿主包只登记 inventory stub（不 `apply`）；显式 / 保留 id 优先
- **队列**：权威快照 `session/queue`；`prompt/*` → `agent/inbox/spliced`；mux 重连可补发 pending queue
- **提问**：mux `question/requested`（rpcId = 问题 id）→ `/api/respond`（先审批后提问；`cancelled` 取消）。`ask_user` 支持自由文本 `question` 与 DSH 形 `questions[]`（options / multi_select）；Face / Host bind 到 broker；mux 重连补 pending。无 UI 时工具仍可回 isError
- **后台任务**：有 jobs 源才发 `session/jobs`；订阅基线只在集合非空时发（空集靠缺帧）；变更推全量快照（清空仍发 `[]`）。无主任务扇出到每个已列出会话。`JobView` 不含 `ownerSession` / `reported` / `outputLimitBytes`
- **附件 / 视觉**：`MessageContent` 可为块数组；`@xrkseek/attachment`；Face `session.attachment`；Host Face 默认 `text+image`。openai-compatible（Registry 非 DeepSeek 品牌）走 `image_url` data URL；官方 DeepSeek 适配器仍 text-only。适配器未声明 `image` 时 loop 抛 `UnsupportedContentError`
- **LLM 流**：OpenAI 兼容适配器默认 `stream()`：SSE `reasoning_content` → `reasoning-delta`（index 0）、`content` → `text-delta`（index 1）；agent-loop 先 append `assistant/chunk` 再 `assistant/message`（可选 `reasoning`）。`chat()` 仍一次性 JSON。DeepSeek 官方适配器不标视觉
- **模型发现**：Face `llm.discoverModels` 对 `settingsNs` `llm` / `llm-pi-ai` 发 openai-chat `GET /models`（draft，不落盘）；失败 `model-discovery-failed` 且 details 不含密钥
- **设置文档**：`settings.openDocument` 忽略浏览器 path；优先 `XRK_POLICY_FILE`，否则写红acted `{productDir}/host-settings.json`；Win/macOS/Linux 用系统默认打开（单测注入 opener）。`settings.describe` 带 schemastery 形 `permission` / `llm` / `ui-theme` / `locale` / `ui-onboarding`（mutate 保留 schema；权限预设只记设置，不改 tool policy）
- **目录选择**：`host.pickDirectory` 弹系统选文件夹；取消 `{ path: null }`；缺 zenity/kdialog 或非桌面平台 `directory-picker-unavailable`（不是假取消）。Win 走 PowerShell STA `FolderBrowserDialog`（单测注入 picker，不弹框）
- **斜杠**：`session.prompt` 已知命令回 `{ command: { kind: "success" } }`；未知 `/name` 当普通 prompt 入账（壳 Zod 不容 `kind: "error"`）；失败已知命令 `command-error`
- **会话搜索**：`session.search` 扫 user/assistant/admit/safety，按最近活动排序，JSONL 仓同一扫描（非 FTS）
- **预设只读**：`agentPreset.read` 返回 catalog markdown；copy/remove/openDocument 回 `agent-preset-read-only`（`authorable: false`）
- **消息反馈**：`messageFeedback/list/put/delete` 进程内 CAS（不写 session 日志）；`messageId` = `{turnId}:{stepId}`
- **Goal**：`/goal` 或 `goals/create`（及 DSH 点号 `goal.create`）写入投影 `goal` 并 admit；pause/resume/edit/clear 走 CAS；`turn/end` 在 `armed` 时续轮，满 `maxGoalRounds`（默认 8）则 `blocked`。Host 旁路 `{XRK_SESSIONS_DIR}/goals.json`。不是独立 Goal fiber
- **Cordis 面板**：`dynamicCordisRunner/inventory` 空列表；stop/undefine 为 not-running / plugin-missing。不 `apply(ctx)`、不跑动态包
- **会话导出**：`HEAD/GET /api/session.export?sessionId=` 返回 ZIP（`sessions/{id}.jsonl` + 子会话 + 附件）；壳先 HEAD 再下载。旁路 JSON 用 tmp+rename；ZIP 条目名剥 `..`
- **MCP**：stdio + streamable-http → `mcp__*` 工具；默认 `mcp.connect` deny；Host 经 `XRK_MCP_*`（`command` 或 `url`）接线；HTTP 转发 SDK `reconnectionOptions`（SSE 恢复）；`tools/list_changed` → `registerMcpTools` 热同步 / Host 刷新 `plugin.tools` + `invalidateAll`（不是进程 supervisor / Face 设置 UI）
- **工具卡**：工具声明 `presentCall` / `presentResult`；Face mux/history `viewFor` 只 lookup（抛错 / 缺 pairing / 无 presenter → 没 view，壳走 generic）。Host 把 preset standing 工具表交给 Face（冷 history 不 wake agent；DSH `ctx.tools.get` 的 standing 层）。`bash` 模型文本用 DSH `[exit code: N]`。不写 session 日志；history 用同一次扫描的 call pairing
- **外壳 / 内核**：产品壳 = `apps/web-static`（DSH Web 捕获，不自研平行聊天 UI）；Host `applyXrkProductBootPolicy` 从 boot 去掉 Cordis 客户端面板与捕获壳 HMR（文件仍可在磁盘）。对接层 = `packages/server/face/src/wire/`；内核仍是 session 事件真源 · 工具瀑布 · compose（不嵌 Cordis Host）；`apps/web` 为 `?console=1` 验证台。Host 测：GET `/` 注入 `__DSH_BOOT__`、plugin 200、缺 plugin 404、boot 不含 cordis UI / HMR
- **CLI**：`xrk-harness run | serve | web | doctor | dump-config`。`serve`/`web` 托管产品壳（按 CLI 包定位）；`--host`/`--port`/`--open`；拒绝 `0.0.0.0`。`run` 认 `XRK_LLM_PRESET`、位置参数与 stdin prompt
- **运行时**：Node ≥ 26

细节：[architecture.md](./architecture.md) · [host-face.md](./host-face.md) · [plugin-loader.md](./plugin-loader.md) · [policy.md](./policy.md) · [modules/](./modules/README.md)
