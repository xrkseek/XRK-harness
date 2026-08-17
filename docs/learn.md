# Learn

本仓已落地的要点（规格与代码为准；不列未实现路线）。

- **Session 事件为对话真源**：模型可见输入可从事件日志重建；turn / loop 短寿
- **工具瀑布**：pre → guards → execute → post → finalize → settle；无全局 proxy
- **能力缝**：Definition / Provider / Consumer
- **Host Face**：Unary RPC + mux/host 双流；未实现方法 `not-implemented`
- **组合叶**：`@xrkseek/compose`；presets 只接线
- **进程插件**：`tools` · `prompt` 已接线；`channel` / `policy` / `llm` 可发现、未自动接线；显式 / 保留 id 优先
- **队列**：权威快照 `session/queue`；`prompt/*` → `agent/inbox/spliced`；mux 重连可补发 pending queue
- **MCP M0**：stdio → `mcp__*` 工具；默认 `mcp.connect` deny；Host 经 `XRK_MCP_*` 接线
- **附件**：`MessageContent` 可为块数组；`@xrkseek/attachment`；Face `session.attachment`；Host 默认 text-only（无 `image` modality 则拒图）；text-only LLM 遇图抛 `UnsupportedContentError`
- **运行时**：Node ≥ 26

细节：[architecture.md](./architecture.md) · [host-face.md](./host-face.md) · [plugin-loader.md](./plugin-loader.md) · [policy.md](./policy.md) · [modules/](./modules/README.md)
