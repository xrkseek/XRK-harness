# Learn

本项目实现时学习了业界 agent harness 的常见做法，规格与代码以本仓为准。

## 学到并落在本仓的要点

- **Session 事件为对话真源**：模型可见输入可从事件日志重建；turn / loop 短寿
- **工具瀑布**：pre → guards → execute → post → finalize → settle；显式 pipeline，无全局 proxy
- **能力缝**：Definition / Provider / Consumer；exec 与 tools 解耦
- **Host Face**：Unary RPC + mux/host 双流；未实现方法诚实 `not-implemented`
- **组合叶**：`@xrkseek/compose`；presets 只接线不写业务

## 万物皆插件（本仓落法）

学习目标：新能力优先「插件贡献 + 接线」，而不是 Host 里再写一条特例。

| 层 | 本仓 | 学到的纪律 |
|----|------|------------|
| Kernel | `definePlugin` + Context 事件 | 服务进容器；注册可逆（teardown） |
| Compose | Scope / Ordering / effect | 依赖声明就绪；卸序可预期 |
| Process | `server-loader` kind 贡献 | 目录发现；kind → `apply*` / `wireComposition*` |

已接线 kind：`tools`（工具表）· `prompt`（system 段）。保留待接线：`channel` · `policy` · `llm`。显式 / 保留 id 优先，插件不静默覆盖。

见 [plugin-loader.md](./plugin-loader.md) · [compose.md](./compose.md)。

## Face / 队列

- **待处理输入不是对话历史**：权威快照是 `session/queue`
- **`prompt/*` → `agent/inbox/spliced`**：坐标按 pending 重放
- **mux 重连**：`session/subscribed` + 有 pending 时补发 `session/queue`
- **主路径护栏**：`prompt → tool → cancel → policy ask`（`harness-path` 测）
- **`session.search`**：内存扫 `user/message` + `assistant/message`（上限 20）

## MCP M0

- `@xrkseek/mcp`：stdio → `mcp__server__tool` → ToolRegistry；**默认 `mcp.connect` deny**
- Host：`XRK_MCP_SERVERS` + `XRK_MCP_ALLOW=1`（或 policy allow）→ 合成 `kind: tools` 插件

## 跟 DSH × 融 AGT × 自研（路线）

立场：体量用本仓真能力堆；壳跟 bar 捕获；AGT 只融产品特色，不搬 Proxy/多语言宿主。

**对照优先级**：wire / 会话 / 附件 / 工具执行等**成熟契约以 DSH 为准**。AGT 仅在产品特色（MEMORY、microagents、office 种子等）上供融合；**AGT 不成熟或与 DSH 冲突处，以 DSH 为准**，不把 AGT 半成品抬进本仓契约。

| 波次 | 内容 | 状态 |
|------|------|------|
| 1 | search · MCP M0 · openPath · skill.list · Host MCP 接线 | 已落 |
| 2 | bar re-capture（rc.7 UI）· `session.attachment`（协议 ContentBlock） | **协议+仓+Face 已落；视觉路由 / re-capture 待** |
| 3 | AGT：office skills · MEMORY · microagents · toolScan（特色融；门禁形态跟 DSH/本仓 pipeline） | 已学 · 排队 |
| 4 | 硬刷 Web · 打磨边界 · 自研差异化 | 持续 |

## 附件 / ContentBlock（跟 DSH，本仓已开刀）

本仓：`MessageContent = string | ContentBlock[]`；`@xrkseek/attachment` 内存仓；Face `session.prompt` 可持久化图（须 `inputModalities` 含 `image`）；`session.attachment` 按事件引用授权读。Host 默认仍 **text-only**（图在写盘前 `unsupported-modality`）。text-only LLM 路径遇图 → `UnsupportedContentError`（禁静默抹平）。

学到的纪律（实现时按此切，不静默降级）：

1. **事件与字节分离**：日志只存不可变引用 + 媒体元数据；字节在独立附件仓；事件可重建。
2. **先持久后入账**：整批准入并 commit，失败不 append `user/message`。
3. **Wire 窄、Core 宽**：prompt 上传用临时 base64 窄联合；canonical 只有 ref；读回另开授权 RPC（`session.attachment`）。
4. **能力三态**：未知 / 显式支持图 / 显式不支持；Host 预检 + Adapter 硬拒双闸（text-only 路由遇图抛稳定错误，禁止 flatten/skip）。
5. **嵌套一致**：`tool-result` 内嵌图与顶层共用同一「是否含图」判定（compaction / 选模 / 序列化）。
6. **引用授权读**：须证明本 session 事件引用了该 id 再出字节；草稿 URL / OS 临时路径永不进日志。
7. **队列编辑不扩模态**：pending edit 只允许 text，堵旁路塞图。

首刀范围建议：光栅图（png/jpeg/webp/gif）+ Face prompt/attachment + protocol 块数组；通用 PDF/音视频、复杂 Web Lightbox **不跟**。DeepSeek 官方 chat 路由可保持 text-only 硬拒，视觉走声明了 `image` 的兼容路由。

## AGT 产品特色（学到的落点，波次 3）

| 特色 | 学什么 | 本仓落点（原则） | 不学 |
|------|--------|------------------|------|
| MEMORY | 工作区 `memory/MEMORY.md` + 日流水；主会话注入长期 | workspace inject + skill 读写纪律 | 默认向量 MCP / 黑盒盖过用户文件 |
| Microagents | frontmatter `triggers` 命中本轮用户文 → 短全文注入；硬预算 | inject 段 + `.xrk/microagents`；文案取自末条 `user/message` | 隔离子进程 / 多语言宿主 |
| toolScan | 统一执行前：policy → 扫 command 类参数威胁 → ask | `ToolPipeline.onPre`（policy 后）；ask 走 Face 审批 | 全局 MCP 上帝对象；只在 adapter 拦；默认全扫 write 正文 |
| Office skills | 种子 `SKILL.md`；prompt 只目录卡，细则 `read` | templates → `.xrk/skills`（`skill.list` 已扫） | 整本 SKILL 常驻 system；注入仓库根 Coding `AGENTS.md` |

纪律重申：融特色，不搬 Proxy / 多语言宿主 / 全局工具代理。

细节见 [architecture.md](./architecture.md) · [tool-pipeline.md](./tool-pipeline.md) · [seams.md](./seams.md) · [host-face.md](./host-face.md) · [policy.md](./policy.md) · **[modules/](./modules/README.md)**（文件级笔记）。

## 运行时

- **Node ≥ 26**（`.nvmrc` · `package.json` engines · CI）
