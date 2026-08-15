# Learn notes（调研 · 不搬仓）

> **不是产品 API 真源。** 实现与缺口以 [../status.md](../status.md) 与测试为准。  
> 笔记内「尚未做」段落可能滞后——吸收清单见 [three-way-map.md](./three-way-map.md) §6（主清单已收束）。

| 笔记 | ID | 摘要 |
|------|-----|------|
| [cline-agent-runtime.md](./cline-agent-runtime.md) | lc1 | AgentRuntime 状态机与 `runTurn` 对照 |
| [cline-session-runtime.md](./cline-session-runtime.md) | lc2 | SessionRuntime 长寿壳；run/continue |
| [cline-mistake-loop-safety.md](./cline-mistake-loop-safety.md) | lc3 | 连续失败 + 重复 tool 环（已落地 session safety） |
| [opencode-session-runner.md](./opencode-session-runner.md) | lc4 | admit≠execute；resume/wake；steer/queue |
| [opencode-tool-settle.md](./opencode-tool-settle.md) | lc5 | materialize / settle（parallel settle 已落地） |
| [opencode-projector-derive.md](./opencode-projector-derive.md) | lc6 | durable 投影 vs `deriveMessages` |
| [three-way-map.md](./three-way-map.md) | lc8 | 总表 + 落地清单 |
| [create-tool-mapping.md](./create-tool-mapping.md) | lc9 | createTool / Tool.make ↔ ToolDefinition |
| [openai-compatible-llm.md](./openai-compatible-llm.md) | lc11 | LLM 兼容 / DeepSeek defaults **深读**（分层·错误码·passback·糟粕） |
| [mcp-protocol.md](./mcp-protocol.md) | lc12 | MCP 规格 + DeepSeek/AGT/Cline 深读；**未实现** |
| [plugin-tools-wire.md](./plugin-tools-wire.md) | lc13 | Plugin tools 接线 · 冲突策略 · 生命周期对照 |
| [policy-gates.md](./policy-gates.md) | lc14 | Policy 门禁绑定点 · ask 空心 · 上游审批 |
| [shipped-audit.md](./shipped-audit.md) | lc15 | 已交付但学习债清单与补学顺序 |
| [provider-matrix.md](./provider-matrix.md) | lc16 | AGT/DeepSeek/Cline 供应商全景 · 分层 · 分期清单 |
| [deepseek-web-ui.md](./deepseek-web-ui.md) | lc17 | DeepSeek 完整壳 · Host Face 最强轨（否决薄壳） |
| [provider-registry.md](./provider-registry.md) | lc18 | AGT 工厂分辨精华 · Registry 最强轨 |
| [u0-prompt-mux-map.md](./u0-prompt-mux-map.md) | lc19 | prompt/mux ↔ XRK session 对照（→ host-face） |
| [web-client-algorithms.md](./web-client-algorithms.md) | lc20 | Boot settle · higher-seq-wins · generation · ChunkFold → `@xrkseek/web-runtime` |
| [face-event-isomorphism.md](./face-event-isomorphism.md) | lc21 | Face 事件同构 + Host tool `view` |
| [xrk-app-shell.md](./xrk-app-shell.md) | lc22 | BootComposition 花名册 · SlotRegistry chrome · AppShell |
| [face-workspace.md](./face-workspace.md) | lc23 | Face U2 workspace.* ↔ `@xrkseek/workspace` |
| [face-settings-credentials.md](./face-settings-credentials.md) | lc24 | settings.* · credentials vault（不入库） |
| ADR [0003](../adr/0003-session-long-loop-short.md) | lc7 | session 长寿 + loop 短寿 |
| ADR [0004](../adr/0004-no-effect-runtime.md) | lc10 | 不引入 Effect 内核 |

画布：`xrk-harness-learn-cline-opencode`。  
产品规格入口：[../README.md](../README.md)。
