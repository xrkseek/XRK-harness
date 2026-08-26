# Reference discovery（`@file` / `@session`）

> **读者**：贡献者 · 维护者

产品壳 `@` 引用栈：`ui-reference` 插件 + `packages/context/*` 契约 + Face 发现 remotes + Face **prepare**（`@xrkseek/xrk-session-reference/prepare-face`，经 preset `prepareUserContent` → `runTurn`）。

## 包地图

| 包 | 路径 | 职责 |
| --- | --- | --- |
| `@xrkseek/client-ui-reference` | `packages/client/ui-reference` | Web 统一 `@file` / `@session` input source |
| `@xrkseek/xrk-file-reference` | `packages/context/file-reference` | `@file` grammar + Remote 契约 |
| `@xrkseek/xrk-file-reference-local` | `packages/context/file-reference-local` | 本地 `WorkspaceFileSearch` |
| `@xrkseek/xrk-session-reference` | `packages/context/session-reference` | `dsh-session:` URI · Face `prepare-face` · Cordis prepare 源 |

Face 薄实现：`packages/server/face/src/reference-discovery.ts` · `handlers/references.ts`（复用 search + session list 投影）。

## Face remotes

| 方法 | 行为 |
| --- | --- |
| `fileReferences/list` | 按会话 `cwd` 返回路径候选 |
| `sessionReferenceResolver/candidates` | 按 id/cwd/title 返回 mention 候选 |

壳侧绑定：`@xrkseek/xrk-api-remotes` · [host-face.md](../host-face.md)。

## Resync

```text
node scripts/resync-context-from-bar.mjs file-reference file-reference-local session-reference
node scripts/resync-context-from-bar.mjs --client ui-reference
node scripts/resync-client-from-bar.mjs ui-input-trigger   # @ 语法 / quoted token
```

## 规格

- [host-face.md](../host-face.md) — RPC 状态  
- [status.md](../status.md) — 能跑 / 未稳边界  
- 包 README — 模块说明  

---

# Reference discovery (`@file` / `@session`)

> **Audience**: Contributors · Maintainers

Product-shell `@` stack: `ui-reference` plugin + `packages/context/*` contracts + Face discovery remotes + Face **prepare** (`@xrkseek/xrk-session-reference/prepare-face` via preset `prepareUserContent` → `runTurn`).

## Package map

| Package | Path | Role |
| --- | --- | --- |
| `@xrkseek/client-ui-reference` | `packages/client/ui-reference` | Unified Web `@file` / `@session` input source |
| `@xrkseek/xrk-file-reference` | `packages/context/file-reference` | `@file` grammar + Remote contract |
| `@xrkseek/xrk-file-reference-local` | `packages/context/file-reference-local` | Local `WorkspaceFileSearch` |
| `@xrkseek/xrk-session-reference` | `packages/context/session-reference` | `dsh-session:` URI · Face `prepare-face` · Cordis prepare source |

Thin Face implementation: `packages/server/face/src/reference-discovery.ts` · `handlers/references.ts` (reuses search + session list projections).

## Face remotes

| Method | Behavior |
| --- | --- |
| `fileReferences/list` | Path candidates for the session `cwd` |
| `sessionReferenceResolver/candidates` | Mention candidates by id/cwd/title |

Shell binding: `@xrkseek/xrk-api-remotes` · [host-face.md](../host-face.md).

## Resync

```text
node scripts/resync-context-from-bar.mjs file-reference file-reference-local session-reference
node scripts/resync-context-from-bar.mjs --client ui-reference
node scripts/resync-client-from-bar.mjs ui-input-trigger   # @ grammar / quoted token
```

## Specs

- [host-face.md](../host-face.md) — RPC status  
- [status.md](../status.md) — Working / Unstable boundaries  
- Package READMEs — module notes  
