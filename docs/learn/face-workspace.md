# Face workspace（U2 · lc23）

> **调研 · 取精华 · 自研。** 把本仓 `@xrkseek/workspace` inject / syncSeeds 接到 Host Face，而不是假目录树。  
> 规格入口：[../host-face.md](../host-face.md) §3 U2。

---

## 0. 立场

| 不做 | 要做 |
|------|------|
| 空壳 `workspace.*` 假成功 | 真实读 `{root}/.xrk` · `resolveWorkspaceInject` |
| 任意绝对路径读盘 | `assertUnderRoot`；`seedDir` 必须在 workspace 内 |
| 密钥入库 / credentials 混进本切片 | settings* · credentials* → 见 [face-settings-credentials.md](./face-settings-credentials.md) |
| 桌面 `openPath` | `canOpenPath: false`（与 host.describe 一致） |

---

## 1. RPC

| Method | 行为 |
|--------|------|
| `workspace.describe` | `root` · `productDir` · `productExists` · `seedTemplates` · `canOpenPath: false` |
| `workspace.listProduct` | 枚举 `.xrk` 树（深度/条数上限；`truncated`） |
| `workspace.previewInject` | 调 `resolveWorkspaceInject`；返回 block 摘要（可选 `includeText` 短 preview） |
| `workspace.syncSeeds` | `{ template }` → `runtime.seedTemplateDirs`；或 `{ seedDir }` 且 under root；缺补不覆盖 |

错误码：`path-escape` · `seed-template-not-found` · `seed-dir-not-found` · `invalid-payload`。

---

## 2. Host 接线

若 `{workspaceRoot}/templates/office-agent` 存在，host 注入  
`seedTemplateDirs: { "office-agent": <abs> }`。

---

## 3. AppShell

`chrome.sidebar` list id=`workspace`：Refresh · Sync office-agent · 条目与 inject 摘要。  
`chrome.status` id=`workspace`：`.xrk` 状态。

---

## 4. 非目标

任意文件编辑器 / fork / settings 全集（settings 见 lc24）。
