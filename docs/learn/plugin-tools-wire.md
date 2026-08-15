# Plugin tools 接线（深读 · lc13）

> **调研笔记。** 产品 API：[../plugin-loader.md](../plugin-loader.md)。  
> 实现已 shipped；本文补「大厂怎么看待贡献 / 冲突 / 生命周期」，避免把静默 skip 当成终局。

---

## 0. 立场

| 原则 | 含义 |
|------|------|
| 本仓角色 | Host `loadAll` + preset `wireCompositionTools`；**不是** Cordis 世界 |
| 已交付 | `kind: tools` → `ToolDefinition[]`；显式名优先 skip；example_ping |
| 取精华 | 冲突可见、贡献协议显式、请求级白名单、卸载后重算目录 |
| 去糟粕 | 静默 skip 且丢弃 skip 列表；假 kind「加载成功但零贡献」；无 learn 就扩 kind |
| 与 MCP | MCP 用命名空间防冲突；本地 plugin **撞 builtin 名** 当前 skip —— 策略要自觉，勿混 |

---

## 1. 本仓已落地

| 件 | 行为 |
|----|------|
| `applyToolsPlugins` | 仅 `kind==="tools"`；`registry.get(name)` 已有 → `explicit_wins` skip |
| `wireCompositionTools` | `extraTools` 先 register（撞则 **抛**）；再 plugins（撞则 **跳**） |
| Host | `plugins` 传入 factory；CLI minimal/server 已传 |
| Manifest | `xrk.plugin.json` / `package.json#xrkseek.plugin`；一级子目录 discover |
| 其它 kind | 可登记；**无**贡献协议（status Partial） |

预设调用 `wireCompositionTools` 后 **丢弃** `{ applied, skipped }` → 运维不可见。

---

## 2. 上游对照

### 2.1 DeepSeek Harness

- 工具插件经 Cordis：`ctx.tools.register`；组合 yml；**schema catalog** 生成/校验精神（`gen-tool-catalog`：漏工具会失败）。  
- MCP 客户端对冲突：**失败可见**、整代回滚，不静默少工具。  
- **不取：** Cordis HMR 原样；把 prompt section 强绑进同一插件类型而不定义协议。

### 2.2 OpenCode

- 规格精神：plugin 作 **config transform**；activate/disable → Policy/Catalog **重载**；防抖。  
- 本仓今天是 **进程内一次 loadAll** —— 无 disable/replay。学「生命周期事件 → 重算可见集」，再谈热更。

### 2.3 Cline

- Extension + 每工具 `toolPolicies` / approval —— **贡献与执行策略同面设计**。  
- 本仓：注册在 loader；策略在 policy —— 可以分面，但要在笔记里钉「谁在何时 enforce」。

### 2.4 AGT

- `streams` 白名单：registry 里有 ≠ 本轮能调。  
- **精华：** 请求路径作用域与「磁盘上有什么插件」正交 —— 本仓未来可在 agent/turn 选项加 allowlist，而不改 loader。

---

## 3. 冲突策略（必须想清楚）

| 策略 | 谁用 | 利弊 |
|------|------|------|
| 显式胜出 + skip 插件 | **本仓现状** | 简单；易静默丢插件工具 |
| 显式胜出 + **日志/指标** skipped | DeepSeek 精神 | 最小补丁 |
| 撞名则 **启动失败** | 严格部署 | 配置错误早暴露 |
| MCP 式强制命名空间 | MCP 桥 | 不适合任意本地 plugin 名 |

**建议（未改代码）：** 保留 explicit_wins，但 preset/host **必须**处理 `skipped`（log 至少）；文档写明「勿依赖静默」。

---

## 4. 糟粕（已在树）

- skip 结果被丢弃  
- `kind: string` 无枚举 → 假插件可「健康里有 id」却零工具  
- example-tools 仅 ping —— 未示范 policy/sandbox 贡献  
- 无 learn 笔记就标 Shipped（产品 doc 有，吸收深度不够）

---

## 5. 吸收清单（扩 kind / 热更前）

- [ ] 冲突策略 ADR 一句话 + 测例（log 或 fail）  
- [ ] `kind` 枚举或未知 kind 警告  
- [ ] 贡献协议草案：tools（已有）· 日后 guards/prompt/mcp  
- [ ] 请求级 allowlist 是否要做（对标 AGT streams）  
- [ ] disable/unload 是否进 v1（对标 OpenCode；默认可不做）  
- [ ] applied/skipped 暴露到 health 或 dumpConfig  

---

## 6. 参考

- 本仓：`packages/server/loader/src/tools.ts` · `docs/plugin-loader.md`  
- DeepSeek：mcp-client 冲突/代际笔记；tool catalog 脚本精神  
- OpenCode：`catalog-config-plugin-lifecycle` 规格族  
- AGT：v3 `streams` / MCPToolAdapter 白名单
