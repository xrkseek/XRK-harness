# Context fragments

> **读者**：贡献者 · 集成者

**Context fragments** 是可插拔、按阶段收集的模型可见上下文，与 **durable workspace inject**（`skill-catalog` / `agent-instructions`）分层：

| 通道 | 包 | 何时 | `user/message.source` |
|------|----|------|------------------------|
| 工作区 inject | `@xrkseek/workspace` | 盘变更时站立注入 | `skill-catalog` · `agent-instructions` |
| Fragments | `@xrkseek/context-fragments` | 每轮 / 每条用户消息可重算 | `context-fragment` |
| Session 召回 | `@xrkseek/xrk-session-reference` | `@session` prepare | `session-reference` |
| 工具 mid-step | `deferContext` | 工具结果后 | 无 typed source（纯文本） |

AGENTS.md / skills catalog 保持 fragment 之外的角色；ephemeral env / recap 不进 inject。

## 阶段

| Phase | Harness 接线 |
|-------|----------------|
| `turn-start` | `beforeUserMessage`：先 `appendWorkspaceInjectsIfChanged`，再 `appendContextFragments` |
| `user-message` | `prepareUserContent`：session refs 之后追加 `fragmentsToPrepareContexts` |
| `post-tool` | Harness：工具 settle 后、`step/end` 前 `appendContextFragments` |

## API（摘要）

```ts
createContextFragmentPipeline({ budgetChars? })
pipeline.register(provider) // → dispose
pipeline.collect(phase, ctx, { budgetChars? })
createAdditionalContextFragment({ key, value, phase })
createRecapFragment({ history })
createStaticAdditionalContextProvider({ id, phase, entries })
appendContextFragments({ store, sessionId, turnId, now, pipeline, phase })
```

预算：相位总字符上限（默认 **8000**）；超出按 `priority` 高者优先，正文可 `truncateMiddle`。

Harness：`createHarnessComposition({ contextFragmentProviders, contextFragmentBudgetChars, locale? })`；`contextFragments: false` 关闭。

Chat 壳对 `fragmentKind: "additional_context"` 使用 `visibility: "hidden"`：模型仍从 session 日志可见，**不**再展开成「上下文注入」行。

Host 在 **turn-start** 注册 `collab-board`：当前工作区 **Agent Team 短目录**（`member_id`）加上 **过去 24 小时内更新过的主线及其已挂主会话 id**。seed 的 AGENTS.md / skills 仍走 workspace inject，不进此 fragment。子会话不注入。模型用 `subagent member_id` 委派，不要把 playbook 再贴一遍。

**工具预审（Auto-review）**不走 fragment 刷屏：会话 `/permission auto` = **无沙箱 + 每调用评审**；Host 将 Settings / `/auto-review` 接到 `createAutoReviewToolPre`（分类器三档：启发式 · HTTP · 会话 LLM；deny 裁决默认 ask→审批；**技术失败**默认 `onClassifierError:'ask'`，可设 `'deny'` fail-closed）。见 [configuration.md](./configuration.md) · [status.md](./status.md)。

## 范围

本仓实现可插拔 **section + budget** 的收集管线（marked additional_context · recap）；工具预审走 auto-review pipeline，不在本包。

相关：[workspace-inject.md](./workspace-inject.md) · [status.md](./status.md)

---

# Context fragments

> **Audience**: Contributors · Integrators

**Context fragments** are a pluggable, phase-collected model-visible context channel, layered **apart** from **durable workspace inject** (`skill-catalog` / `agent-instructions`):

| Channel | Package | When | `user/message.source` |
|---------|---------|------|------------------------|
| Workspace inject | `@xrkseek/workspace` | Standing inject on disk change | `skill-catalog` · `agent-instructions` |
| Fragments | `@xrkseek/context-fragments` | Recomputable each turn / user message | `context-fragment` |
| Session recall | `@xrkseek/xrk-session-reference` | `@session` prepare | `session-reference` |
| Mid-tool | `deferContext` | After tool results | plain text (no typed source) |

Do not move AGENTS.md / skill catalogs into fragments; do not put ephemeral env / recap into inject.

## Phases

| Phase | Harness wiring |
|-------|----------------|
| `turn-start` | `beforeUserMessage`: `appendWorkspaceInjectsIfChanged` then `appendContextFragments` |
| `user-message` | `prepareUserContent`: session refs then `fragmentsToPrepareContexts` |
| `post-tool` | Harness: after tool settle, before `step/end`, `appendContextFragments` |

## API (summary)

```ts
createContextFragmentPipeline({ budgetChars? })
pipeline.register(provider) // → dispose
pipeline.collect(phase, ctx, { budgetChars? })
createAdditionalContextFragment({ key, value, phase })
createRecapFragment({ history })
createStaticAdditionalContextProvider({ id, phase, entries })
appendContextFragments({ store, sessionId, turnId, now, pipeline, phase })
```

Budget: per-phase char ceiling (default **8000**); higher `priority` wins; bodies may `truncateMiddle`.

Harness: `createHarnessComposition({ contextFragmentProviders, contextFragmentBudgetChars, locale? })`; `contextFragments: false` disables.

The chat shell marks `fragmentKind: "additional_context"` as `visibility: "hidden"`: still model-visible from the session log, **not** rendered as expandable 「上下文注入」 rows.

Host registers **`collab-board`** at **turn-start**: the workspace **Agent Team catalog** (`member_id`) plus **parent sessions bound to a 主线 updated in the last 24 hours**. Seed AGENTS.md / skills stay on workspace inject and are not copied into the fragment. Delegated children skip it. Spawn with `subagent member_id`; do not paste playbooks.

**Tool pre-review (Auto-review)** is not fragment spam: session `/permission auto` = **no sandbox + per-call review**; Host wires Settings / `/auto-review` to `createAutoReviewToolPre` (classifier tiers: heuristic · HTTP · session LLM; deny verdicts default ask→approval; **technical failures** default `onClassifierError:'ask'`, or `'deny'` fail-closed). See [configuration.md](./configuration.md) · [status.md](./status.md).

## Scope

This repo ships the pluggable **section + budget** collection pipeline (marked additional_context · recap). Tool pre-review is auto-review on the pipeline, not this package.

Related: [workspace-inject.md](./workspace-inject.md) · [status.md](./status.md)
