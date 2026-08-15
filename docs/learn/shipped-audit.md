# 已交付切片 · 学习审计（lc15）

> 针对「已经写进仓库、但学习深度不够」的能力。  
> **不改代码**；纠偏靠补 learn + 勾选后再动刀。金标准文风：[mcp-protocol.md](./mcp-protocol.md)。

## 问题

近期为冲体量，下列能力 **产品已 Shipped**，但吸收笔记过薄或缺失——与 MCP「先学后做」相反：

| 域 | 产品 | Learn（补前） | 风险 |
|----|------|---------------|------|
| LLM openai-compat / deepseek defaults | Shipped | lc11 一页清单 | 假「官方 DeepSeek」、脆弱 overflow |
| Plugin tools 接线 | Shipped | 无 | 静默 skip、假 kind |
| Policy | Engine Shipped；主机半接 | 无 | hollow subject、空心 ask |
| MCP | Empty | lc12 深读 | 正确示范 |
| Cordis | **非目标（不并核）** | [lc25](./cordis.md) 深读 | 假懂 / 误把 Proxy ctx 引进 kernel |

## 已补笔记

| ID | 笔记 | 作用 |
|----|------|------|
| lc11 | [openai-compatible-llm.md](./openai-compatible-llm.md) | **重写**为深读 |
| lc13 | [plugin-tools-wire.md](./plugin-tools-wire.md) | 新建 |
| lc14 | [policy-gates.md](./policy-gates.md) | 新建 |
| lc12 | [mcp-protocol.md](./mcp-protocol.md) | 已有；继续作金标准 |
| lc25 | [cordis.md](./cordis.md) | Cordis 时空可组合；对照本仓显式对象图 |

## 建议学习/改码顺序（仍先学）

1. ~~**Policy 主机绑定**~~ — lc14 主路径已接（ask/approval 见近切片）  
2. **Cordis 标尺** — [lc25](./cordis.md)（跑完 DSH tutorial 七章；**不并核**）  
3. **LLM 错误码 / 流式契约** — 见 lc11 §5（再碰 thinking）  
4. **Plugin 冲突可见性** — 见 lc13 §5（再扩 kind）  
5. **MCP Client** — lc12 §8 勾完再规格  

## 纪律

- status.md 可依赖面 ≠ learn 已尽。  
- 发现「文档示例未接线」→ 先改 learn/安全清单诚实度，再改代码。  
- 禁止用新功能掩盖未学债。
