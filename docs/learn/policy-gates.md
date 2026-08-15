# Policy 门禁（深读 · lc14）

> **调研笔记。** 产品 API：[../policy.md](../policy.md)。  
> Engine shipped；Host/`XRK_POLICY_FILE` → Face `provider.use` **已接**；ask → `approval/*` + AppShell **已接**。

---

## 0. 立场

| 原则 | 含义 |
|------|------|
| 本仓模型 | 有序规则 · **先匹配获胜** · 每 kind 默认；桥到 ToolPipeline |
| 已接 | preset `onPre`；`XRK_POLICY_FILE` → Face `provider.use`；**ask → approval 事件 + Face respond + Host setApprovalHandler** |
| 未接（空洞） | `mcp.connect` 真 Client；审批超时策略（现仅 abort→cancel） |
| 取精华 | 门面分离、会话可重建的审批事件、委托收紧、通配与分层覆盖 |
| 去糟粕 | ask 无审批却当产品能力吹；规则集与匹配语义盲抄 |
| 匹配语义 | OpenCode 部分规格 **后匹配获胜** —— 移植规则集前先对齐，勿盲抄 |

---

## 1. 本仓已落地

| 面 | 内容 |
|----|------|
| Subjects | `tool.call`（可带 args，**尚无规则用 args**）· `provider.use` · `mcp.connect` |
| Verdicts | allow / deny / ask |
| Defaults | tool/provider **allow**；mcp.connect **deny** |
| Ruleset JSON v1 | deny / ask / allow-only；mcp 规则目前主攻 deny |
| Bridges | `createPolicyToolPre`（ask→pipeline ask）；`createPolicyToolGuard`（ask→deny）；denylist 兼容 |
| Preset | `policy?: PolicyEngine` 可选 → tool `onPre` |
| Host | `XRK_POLICY_FILE` → `createPolicyEngineFromFile` → FaceRuntime.policy |
| Face | `session.selectModel` → `provider.use`；`session.respondApproval` → broker |
| Events | `approval/asked` · `approval/decided`（log-only） |
| AppShell | mux `session/approvals` + Allow/Deny |

安全清单：ask 已接 Face/AppShell；无超时自动审批。

---

## 2. 上游对照

### 2.1 OpenCode `provider-policy`

- Provider 可用性与凭据分开；配置作者写 policy；默认 allow。  
- 明确 **不做 ask/approval 词汇**（审批另面）——更干净。  
- 学习：本仓可把 `provider.use` 当「能不能选这路模型」，把 `ask` 留给 tool。

### 2.2 DeepSeek 审批

- `dsh-user-approval` + session 事件 `approval/asked|decided` —— **可从 session 重建**。  
- Subagent **收紧**：子不能放大父审批。  
- 学习：若做 ask，必须落事件，不能只在内存 Promise。

### 2.3 Cline

- `toolPolicies` + `requestToolApproval` —— builder 里一等公民。  
- autoApprove 默认与 per-tool 开关。  

### 2.4 AGT

- 工作流/streams 白名单 + MCP adapter —— **API 边界**再挡一层。  
- 与 pipeline pre 互补，不是二选一。

---

## 3. 门禁该钉在哪（主机图）

```text
选 LLM          → assertPolicyAllow(provider.use)     【Face selectModel + XRK_POLICY_FILE】
MCP connect     → assertPolicyAllow(mcp.connect)      【Client 空壳】
工具执行        → pipeline onPre / onGuard(tool.call) 【preset 仅 onPre】
HTTP 暴露面     → 可选再套一层 allowlist               【未接】
```

**精华：** 一种 subject 一个绑定点；不要第四个上帝 PolicyService 绕过 pipeline。

---

## 4. 糟粕 / 空洞（已在树）

| 项 | 说明 |
|----|------|
| Hollow subjects | mcp 仍空壳；provider.use **已**在 Face 选模路径评价 |
| ask 空心 | 无 onApproval 主机时，行为依赖 pipeline 默认（常等价失败/deny） |
| Guard 未挂 | `createPolicyToolGuard` 与 Pre 语义不同；文档并写易误用 |
| args 死面 | subject 可带 args，无规则匹配 |
| first vs last match | 与 OpenCode 不同，learn/产品未强调 |
| defaults.ask | 解析允许，但部分 kind 的规则 action 拒绝 ask —— 作者体验不一致 |

---

## 5. 吸收清单（宣称「policy 闭环」前）

- [x] Host/CLI：`XRK_POLICY_FILE` 装载  
- [x] 选 LLM 处 `provider.use`  
- [x] ask：`onApproval` + session `approval/*` + Face respond  
- [ ] 文档：first-match 醒目；Pre vs Guard 选用表（可再打磨）  
- [ ] mcp.connect allow-only 与 Client 同切片  
- [ ] args 匹配：做或从类型面删除  
- [x] 安全清单与 status 对齐「已接路径」（本轮已更新 status/policy）  

---

## 6. 参考

- 本仓：`packages/policy/**` · `docs/policy.md` · `docs/security-checklist.md`  
- OpenCode：`provider-policy` 规格  
- DeepSeek：user-approval / subagent 审批收紧  
- Cline：`toolPolicies` · `requestToolApproval`  
- AGT：streams 白名单
