# References

外部参考 **只作调研**；实现自研。不并入上游源码树（[ADR-0002](./adr/0002-no-embed-upstream.md)）。

## 优先级（与 AGENTS.md 一致）

1. **DeepSeek Harness** — Host≠Preset、session 真源、工具瀑布骨架  
2. **XRK-AGT** — 热路径契约（三层消息、Workspace、MCP 门禁目标）  
3. **cline / opencode** — 分层与 session/tool 形状  
4. 其余 XRKbar agent 项目 — 专项  

本仓吸收记录：[learn/](./learn/README.md) · 总表 [three-way-map.md](./learn/three-way-map.md) · 供应商矩阵 [provider-matrix.md](./learn/provider-matrix.md) · 已交付学习债 [shipped-audit.md](./learn/shipped-audit.md) · LLM [openai-compatible-llm.md](./learn/openai-compatible-llm.md) · 插件 [plugin-tools-wire.md](./learn/plugin-tools-wire.md) · 门禁 [policy-gates.md](./learn/policy-gates.md) · MCP [mcp-protocol.md](./learn/mcp-protocol.md)。

## 本仓决策

- [adr/](./adr/README.md)  
- [architecture.md](./architecture.md) · [status.md](./status.md)

## 注意

- learn 笔记中的「尚未做」可能已过时；以 **status.md + 测试** 为准。  
- 「MCP 门禁」是 AGT **契约目标**；`@xrkseek/mcp` 仍为空壳，不可当成已交付能力引用。权威规格与吸收清单见 [learn/mcp-protocol.md](./learn/mcp-protocol.md)（**先学后做**）。
