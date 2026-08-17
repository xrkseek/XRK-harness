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

| 波次 | 内容 | 状态 |
|------|------|------|
| 1 | search · MCP M0 · openPath · skill.list · Host MCP 接线 | 本轮 |
| 2 | bar re-capture（rc.7 UI）· `session.attachment`（协议 ContentBlock） | 下一刀 |
| 3 | AGT：office skills 包 · MEMORY · trigger microagents · toolScan | 排队 |
| 4 | 硬刷 Web · 打磨边界 · 自研差异化 | 持续 |

细节见 [architecture.md](./architecture.md) · [tool-pipeline.md](./tool-pipeline.md) · [seams.md](./seams.md) · [host-face.md](./host-face.md) · [policy.md](./policy.md) · **[modules/](./modules/README.md)**（文件级笔记）。

## 运行时

- **Node ≥ 26**（`.nvmrc` · `package.json` engines · CI）
