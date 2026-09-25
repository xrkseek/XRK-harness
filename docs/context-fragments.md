# Context fragments

> **读者**：贡献者 · 集成者

**Context fragments** 是可插拔、按阶段收集的模型可见上下文，与 **durable workspace inject**（`skill-catalog` / `agent-instructions`）分层：

| 通道 | 包 | 何时 | `user/message.source` |
|------|----|------|------------------------|
| 工作区 inject | `@xrkseek/workspace` | 盘变更时站立注入 | `skill-catalog` · `agent-instructions` |
| Fragments | `@xrkseek/context-fragments` | 每轮 / 每条用户消息可重算 | `context-fragment` |
| Session 召回 | `@xrkseek/xrk-session-reference` | `@session` prepare | `session-reference` |
| 工具 mid-step | `deferContext` | 工具结果后 | 无 typed source（纯文本） |

不要把 AGENTS.md / skills catalog 改成 fragment；也不要把 ephemeral env / recap 放进 inject。

## 阶段

| Phase | Harness 接线 |
|-------|----------------|
| `turn-start` | `beforeUserMessage`：先 `appendWorkspaceInjectsIfChanged`，再 `appendContextFragments` |
| `user-message` | `prepareUserContent`：session refs 之后追加 `fragmentsToPrepareContexts` |
| `post-tool` | 管线已支持；Host 可在工具 settle 后自行 `collect` |

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

Harness：`createHarnessComposition({ contextFragmentProviders, contextFragmentBudgetChars })`；`contextFragments: false` 关闭。

## 范围

本仓实现可插拔 **section + budget** 的收集管线（marked additional_context · recap）；完整 Guardian 审阅引擎不在范围内（见 status）。

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
| `post-tool` | Pipeline supports it; Host may `collect` after tool settle |

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

Harness: `createHarnessComposition({ contextFragmentProviders, contextFragmentBudgetChars })`; `contextFragments: false` disables.

## Scope

This repo ships the pluggable **section + budget** collection pipeline (marked additional_context · recap); a full Guardian review engine is out of scope (see status).

Related: [workspace-inject.md](./workspace-inject.md) · [status.md](./status.md)
