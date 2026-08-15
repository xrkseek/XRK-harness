# Face settings / credentials（U2 · lc24）

> **调研 · 取精华 · 自研。** 公开设置可写；密钥永不入库、永不进 session 日志、RPC 永不回显明文。  
> 规格入口：[../host-face.md](../host-face.md) §3 U2。

---

## 0. 立场

| 不做 | 要做 |
|------|------|
| 假 `settings.*` 空成功 | `ui` 可写 · `host`/`llm` 只读快照 |
| 密钥写入 JSONL / 磁盘 | `FaceCredentialVault` 仅进程内存 |
| RPC 返回 secret 明文 | `credentials.list` 只给 `configured` / `source` |
| 经 Face 改 host port/workspace | `settings-readonly` |

---

## 1. RPC

| Method | 行为 |
|--------|------|
| `settings.get` | `{ scopes, values }`；可选 `scope` 过滤 |
| `settings.set` | 仅 `scope: "ui"` + `patch`（theme/locale） |
| `credentials.list` | 槽位 `host.apiKey` + 各 brand `llm.<id>` |
| `credentials.set` | `{ slotId, value }` 或 `{ clear: true }` → vault |

### settings scopes

| scope | writable | 内容 |
|-------|----------|------|
| `ui` | yes | `theme`: system\|light\|dark · `locale` |
| `host` | no | host/port/workspaceRoot/preset/cors/rateLimit/pluginsDir/webDistConfigured |
| `llm` | no | brands 摘要 · routable |

### credentials

- `source`: `vault` \| `env` \| `none`（host 槽把 bootstrapApiKey 算作 env 侧）
- Host Face HTTP 鉴权：`effectiveHostApiKey` = vault override ?? bootstrap
- 清 vault 后回落到 bootstrap/env

错误码：`settings-readonly` · `settings-invalid` · `settings-scope-not-found` · `credentials-slot-not-found` · `credentials-too-large` · `invalid-payload`。

---

## 2. AppShell

`chrome.sidebar` id=`settings`：UI theme/locale · credentials 槽列表 · Set/Clear host key（密码框，不回显日志明文由服务端保证）。

---

## 3. 非目标

持久化密钥到文件 · OS keychain · OAuth · DeepSeek Cordis settingsScope 全集。
