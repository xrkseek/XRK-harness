# MCP 协议与大厂吸收（lc12）

> **调研笔记 · 禁止当产品 API。** `@xrkseek/mcp` 仍是 empty shell（[status.md](../status.md)）。  
> 写法：先把规格与上游**想清楚**，再谈切片；本文可随新读源更新，但**不**替代未来的 `docs/mcp.md` 产品规格。

---

## 0. 立场（先立规矩）

| 原则 | 对本仓 |
|------|--------|
| 权威真源 | [MCP Spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/) + schema；草案（如 2026-07-28）只观察 |
| 调研不搬仓 | [ADR-0002](../adr/0002-no-embed-upstream.md)；DeepSeek / AGT / Cline **读思路**，不并源码树 |
| 角色 | 本仓优先做 **Host 内的 MCP Client**（连外部 Server → 本地 `ToolDefinition`）；AGT 式「对外当 MCP Server」后置 |
| 取精华 | 官方 SDK 管 wire；稳定命名空间；门禁；有界生命周期 |
| 去糟粕 | 自造帧格式；裸工具名；静默跳过冲突；用远端 `serverInfo.name` 当命名空间；一上来 Resources/Prompts/OAuth 全家桶 |
| 未学完不编码 | 半截 Content-Length 客户端已回滚；实现前须另开产品规格 + 勾选 §8 |

---

## 1. 规格骨架（必须背准的细节）

### 1.1 三角色

规格用语（勿与本仓「Host 平面 / Session 平面」混名）：

- **Host** — LLM 应用（本仓：harness / `serve`）
- **Client** — Host 内连接器（目标包：`@xrkseek/mcp`）
- **Server** — 提供 tools / resources / prompts 的进程或 HTTP 服务

### 1.2 Transport（stdio 细节最容易写错）

权威：[Transports 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

**stdio（Clients SHOULD 支持）**

| 规则 | 含义 |
|------|------|
| Client **spawn** Server | 不要「先手工起 server 再连」当默认路径；SDK `connect(transport)` 拥有子进程 |
| **NDJSON** | 一行一条 JSON-RPC；消息 **MUST NOT** 含嵌入换行 |
| stdout / stderr | stdout **只能**是 MCP 消息；日志走 stderr；Client 勿把 stderr 当错误判据 |
| **不是** LSP `Content-Length` | 官方 TS/Python SDK 均为 NDJSON；手写 Content-Length = 违规（曾踩坑，已纠正） |

**Streamable HTTP**（取代 2024-11-05 HTTP+SSE）

- 单一 MCP endpoint：POST（消息）+ 可选 GET（SSE）
- 安全：校验 `Origin`、本地宜绑 localhost、宜鉴权
- Session：`MCP-Session-Id`；后续请求带 `MCP-Protocol-Version`
- DeepSeek 经验：HTTP 侧断线多由 **SDK 传输自己的 SSE 恢复** 处理；Host 侧重连监督主要对 **stdio 子进程崩溃** 有意义

### 1.3 Lifecycle

权威：[Lifecycle 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)

```text
initialize (version + capabilities + clientInfo)
  → InitializeResult (协商 version / capabilities / serverInfo)
  → notifications/initialized
  → Operation（只用已协商能力）
  → Shutdown（stdio：关 stdin → 等退出 → SIGTERM → SIGKILL）
```

细节：

- initialize **之前** Client 不应发业务请求（除 ping 类例外）
- Server 在收到 `initialized` 前不应发业务请求
- 版本：Client 报自己最新支持版；Server 可回落；Client 不支持则断开
- 请求应有 **超时**；可配合 cancellation / progress（规格 SHOULD）

官方 TS 客户端习惯（[first client](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-client.html)）：

- `Client` + 一个 `Transport` = 完整客户端；`connect()` 完成握手
- **`close()` 放 `finally`**，否则崩溃留下孤儿子进程
- `callTool` 的执行失败常是 **`isError: true` 的普通 result**，不是抛异常

### 1.4 Tools（第一能力面）

权威：[Tools 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

| 消息 | 用途 |
|------|------|
| `tools/list` | 发现；支持 `cursor` / `nextCursor` **分页**（必须 drain 全部分页再注册） |
| `tools/call` | `{ name, arguments }` — name 是 Server 侧 **raw** 名 |
| `notifications/tools/list_changed` | 若 capability `tools.listChanged` → Client 应 re-list |

结果形状：

- `content[]`：text / image / audio / resource_link / embedded resource
- 可选 `structuredContent` + `outputSchema`
- **协议错误**（未知工具）→ JSON-RPC `error`
- **执行错误** → 结果里 `isError: true`（留给模型自纠）

安全提示（规格）：tool annotations **不可信**（除非信任该 Server）；敏感调用宜人在回路。

**第一切片明确不做：** resources · prompts · sampling · elicitation · tasks · 完整 OAuth / confused-deputy 缓解（HTTP 远程以后再开专题）。

---

## 2. 行业共识：工具命名（大厂几乎同款）

跨产品调研（DeepSeek Agent Note 已汇总；本仓只记结论）：

| 产品 | 模型可见名形状 |
|------|----------------|
| Claude Code / Codex | `mcp__<server>__<tool>` |
| Gemini CLI / VS Code / Goose / OpenCode 等 | **按 server 限定**（拼写略有差别） |
| DeepSeek Harness | 与 Claude/Codex **同拼写** + 规范化/哈希 |
| Cline | `server__tool`（**无**字面 `mcp__` 前缀）+ sanitize + 短 hash |

**为什么必须命名空间（精华）：**

- MCP 只保证 **单 Server 内** 工具名唯一；跨 Server 冲突是常态（微软调研：大量重名 `search` 等）
- 裸名 / 「冲突再加前缀」会使可用集依赖 **加载顺序**，并在中途 **静默重命名** → 会话历史与权限规则失效
- `serverName` 必须是 **本地配置**，不能用远端 `serverInfo.name`（不可信、不唯一、升级可变）

**规范化共性：**

- 模型/厂商函数名常限 **64 字符**、`[A-Za-z0-9_-]`
- lossy 时追加 **(server, raw) 的确定性 hash**，防碰撞折叠

**对本仓建议（未实现 · 仅方向）：**

- 倾向 DeepSeek/Claude 拼写 `mcp__<serverId>__<raw>`（权限可写 `mcp__*`）
- 若与现有 `ToolDefinition` 名长冲突，再定本仓字符表；**不要**发明第三种「半命名空间」

---

## 3. DeepSeek Harness `mcp-client`（优先级 1 · 学架构）

本地对照：`deepseek-harness/packages/mcp/mcp-client` + Agent Notes：

- `2026-07-07-mcp-client-plugin(.zh).md`
- `2026-08-06-mcp-client-auto-reconnect(.zh).md`

### 3.1 分层（取其结构，不取 Cordis）

```text
Config (stdio | streamable-http + serverName)
  → Transport factory（官方 SDK）
  → Connection supervisor（代际 Client、重连预算、dispose 栅栏）
  → Tool bridge（list 分页 → publicName → register；list_changed → 整代切换）
  → ToolRuntime.execute（闭包持 rawName；wire 永不发 publicName）
```

| 决策 | 精华 | 对本仓 |
|------|------|--------|
| 官方 `@modelcontextprotocol/sdk` | 不自造 JSON-RPC/帧/握手 | **推荐**；与「ACP 也委托官方 SDK」同理 |
| 只做 Client · 只桥 Tools | Resources/Prompts 缺消费面则后置 | 一致 |
| 一 Server 一实例 | 配置隔离、dispose 清晰 | preset/host 上「每 server 一条配置」 |
| `serverName` 本地且唯一 | 后加载重复名 **失败**，不覆盖 | 对齐；映射本仓 `serverId` |
| 命名不变式 5 条 | 见下 | 产品规格应抄精神 |
| env scrub（stdio） | 去 KEY/PASSWORD/SECRET/TOKEN、前缀凭据 | 必学；可用 exec/subprocess 同类 scrub |
| `toolCallTimeoutMs` | 默认 60s；signal 取消 | 必学 |
| list 分页 drain | 不全量 list 就注册 = 残缺 | 必学 |
| 代际同步 | 失败保留上一代；冲突 **整代回滚** 不留半套 | 必学 |
| 重连有界退避 | 稳定窗口重置预算；崩溃环耗尽则卸工具 | **v1 可后置**，但文档要写清「未做时工具会僵死」 |
| 不静默 skip | 冲突/坏 list → 抛错或整代失败 | 对齐本仓「显式优先」文化 |
| 测试金字塔 | mock SDK 单元 + fixture/真实 server E2E；刻意无快照 | 本仓同样：无密钥 E2E fixture |

### 3.2 命名不变式（精华原文精神）

1. 稳定标识 `(serverName, rawName)` ↔ 恰好一个 publicName  
2. publicName 确定性、全局唯一、满足厂商名约束  
3. `tools/call` **永远**只带 rawName  
4. 连/断/重同步 **其它** Server 不重命名已有工具  
5. **注册顺序**不决定谁可用  

### 3.3 曾否决方案（去糟粕 · 勿重蹈）

| 否决项 | 原因 |
|--------|------|
| 裸名 + 可选 `toolPrefix` | 生态大量无前缀裸名；冲突依赖顺序 |
| 仅 `server__tool` 无 `mcp__` | 与原生工具撞车；丢全局策略模式（DeepSeek 观点；Cline 选了无前缀——本仓需显式二选一） |
| 用 `serverInfo.name` 当命名空间 | 不可信 |
| v1 无限重连 | 部分可用态 + 配置错误刷屏（后以有界预算补回） |
| 断连立刻卸工具再挂上 | schema 前缀抖动伤 KV cache / 权限 |
| 预防性三包 seam | 无第二种实现前不拆 |

### 3.4 去其「糟粕 / 不适配」

- **Cordis** 插件生命周期、HMR、`ctx.tools` — 本仓用 preset + registry + host，不引入 Cordis  
- Effect / fiber 术语 — ADR-0004  
- DeepSeek 特有 64 字符与图片块丢弃策略 — 按本仓 `ToolResult` 能力另定映射，勿盲抄  
- 100% 包覆盖率门禁 — 本仓维持现有 check 标准即可  

---

## 4. XRK-AGT（优先级 2 · 契约与门禁）

对照：`XRK-AGT/docs/mcp-guide.md`（自报协议 **2025-11-25**）。

| 吸取 | 含义 |
|------|------|
| AGT 主角色是 **MCP Server** | 对外 JSON-RPC；工作流 `registerMCPTool` |
| **白名单门禁** | v3 chat → `streams` → 只有声明工作流下的工具可被 `handleToolCalls` 执行 |
| stdio `shell: false` 默认 | 防命令注入 |
| ALS / 请求上下文 | 并发消息不串线（精神：调用上下文隔离） |

**本仓映射：**

- Client 侧：`policy.mcp.connect`（默认 deny）= 「能不能拉起/连这个 Server」  
- 工具执行：桥成 `ToolDefinition` 后仍走 **既有** `tool.call` pipeline / policy（勿另开旁路）  
- 「local as MCP Server」= AGT 长板，**后置**；勿在 Client 切片里夹带  

**不取：** 并 HTTP/WS MCP 服务端实现；80 个工作流工具清单。

---

## 5. Cline（优先级 3 · 配置与命名变体）

| 吸取 | 含义 |
|------|------|
| 配置 transport 枚举 | stdio / sse / http / streamable-http 别名 — 配置面要宽容、实现面收敛 |
| `name-transform` | sanitize + 64 上限 + hash；**无** `mcp__` 字面前后缀 |
| Hub + list change | 工具列表变更要有明确刷新路径 |

**不取：** VS Code Marketplace、企业 remote allowlist 整套 UI。

**对本仓：** 命名拼写以 DeepSeek/Claude 族为默认推荐；若未来要兼容 Cline 形，用显式 `nameStyle` 选项，**不要**默默混用。

---

## 6. 安全（规格 + 实操）

权威补充：[Security Best Practices 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices)

与本仓近期相关的实操层（先做 Client/stdio）：

| 风险 | 缓解 |
|------|------|
| 任意代码执行（stdio 命令） | `mcp.connect` deny-by-default；显式 allow-only `serverId`；配置审核 |
| 命令注入 | `shell: false`；argv 数组而非 shell 字符串 |
| 凭据泄漏进子进程 | env scrub + 仅显式传入的密钥 |
| 恶意/潦草 tool schema | 透传但标注「垃圾进垃圾出」；执行仍受 `tool.call` policy |
| 挂死 | per-call timeout + AbortSignal |
| HTTP confused deputy / OAuth | **远程 HTTP 切片再学**；v1 stdio 不假装已解决 |

本仓已有：`policy` 默认 `mcp.connect: deny`（engine）；ruleset **allow** 解锁仍属「实现时」改动，学完再动。

---

## 7. 对照本仓现状（诚实缺口）

| 已有 | MCP 仍缺 |
|------|----------|
| `ToolDefinition` · pipeline · settle · plugin tools 接线 | Client / transport / 命名桥 |
| `mcp.connect` 默认 deny | allow-only serverId、connect 前 assert |
| Session 事件真源 | MCP 工具结果如何写入 session — 走现有 tool/result 即可，勿另开事件族 |
| learn openai-compatible | 与 MCP **正交**（模型 tool_calls ↔ 本地 registry） |

**已纠正的错误实践：** Content-Length stdio、未读 DeepSeek 不变式就开写、空壳未学先改依赖。

---

## 8. 吸收清单（实现前勾选 · 仍须产品规格）

勾选完 → 写 `docs/mcp.md` → 再改 `status` → 再编码。未勾选不得把包标成 Shipped。

### 规格锁定

- [ ] 目标协议：`2025-11-25`（negotiate 可回落 `2025-03-26`）  
- [ ] Transport v1：**stdio only**（HTTP 单列后续切片）  
- [ ] 能力面 v1：**tools only**  
- [ ] Wire：**官方 SDK**（不自造帧）  

### 产品契约

- [ ] 配置：`serverId` + command/args/env/cwd + timeout  
- [ ] 命名：`mcp__<serverId>__<raw>` + 规范化算法（测例锁死）  
- [ ] `assertPolicyAllow(mcp.connect)` 先于 spawn  
- [ ] ruleset：`mcp.connect` allow-only / defaults allow 解锁策略  
- [ ] 桥：`list` 分页 → `ToolDefinition[]` → registry；`call` 用 rawName  
- [ ] 结果映射：多 text 如何合成 **一条** 本仓 `content`（防丢边界）  
- [ ] dispose / close：stdin 关闭 + 超时杀进程；`finally`  
- [ ] 冲突：与原生工具、与其它 MCP server — **失败可见**，不静默  

### 明确后置（写进规格「不做」）

- [ ] Streamable HTTP + OAuth / session hijack 专题  
- [ ] 有界 auto-reconnect（可先文档说明「崩溃须重载」）  
- [ ] Resources / Prompts / Sampling  
- [ ] 对外 MCP Server（AGT 角色）  
- [ ] plugin `kind: mcp` 自动发现（先手动/配置接线）  

### 测试最低线

- [ ] mock SDK：命名、门禁 deny、raw vs public 纪律  
- [ ] fixture NDJSON/stdio server：initialize → list → call  
- [ ] 无真实第三方密钥  

---

## 9. 参考

**官方**

- https://modelcontextprotocol.io/specification/2025-11-25/  
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports  
- https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle  
- https://modelcontextprotocol.io/specification/2025-11-25/server/tools  
- https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices  
- https://github.com/modelcontextprotocol/typescript-sdk  
- https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-client.html  

**Bar / 对照仓（本地 · 不并入）**

- DeepSeek：`packages/mcp/mcp-client` + `.agents/notes/.../mcp-client-*.md`  
- AGT：`docs/mcp-guide.md`  
- Cline：`sdk/.../extensions/mcp/name-transform.ts`  

**本仓**

- [references.md](../references.md) · [policy.md](../policy.md) · [security-checklist.md](../security-checklist.md) · [migrate-from-agt.md](../migrate-from-agt.md)

可选画布：`xrk-harness-learn-mcp`。
