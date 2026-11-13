# Context fragments

> **读者**：贡献者 · 集成者

**Context fragments** = 按阶段收集、可重算的模型可见上下文。和盘上的 **durable workspace inject**（`skill-catalog` / `agent-instructions`）分开管：站立文案走 inject，热文案走 fragment。

| 通道 | 包 | 何时 | `user/message.source` |
|------|----|------|------------------------|
| 工作区 inject | `@xrkseek/workspace` | 盘变更时站立注入 | `skill-catalog` · `agent-instructions` |
| Fragments | `@xrkseek/context-fragments` | 每轮 / 每条用户消息可重算 | `context-fragment` |
| Session 召回 | `@xrkseek/xrk-session-reference` | `@session` prepare | `session-reference` |
| 工具 mid-step | `deferContext` | 工具结果后 | 无 typed source（纯文本） |

AGENTS.md / skills catalog 不进 fragment；瞬时 env / recap 不进 inject。

**窗内 last-wins：** 每轮仍 append 一条 `user/message`（日志全留）；进模型窗时，同 `fragmentId` 只留最新。权限、席位、工具路由这类活文案就不会叠成旧快照墙。

**双轴：** 通道（system · durable · fragment · tools[] · derive）可以拆开；会变的说明文案按碎片语义管（稳定 id · 可重算 · last-wins）。`tools[]` 只留薄契约（name · 短 description · JSON schema），整份 catalog 别碎片化。分层草图见 Cursor Canvas `context-engineering-layers`。

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

Host **turn-start**（priority 高→低）：`instruction_authority` · `session_capability`（`mcp_mount` / `ask:`）· `session_posture`（IM/奇创/harness·shallow；Frugal/Shell 空）· `boss_status` · `seat_identity` · `collab_board`（名册 ids + 近 24h 主线；同道一句，长派活链在 posture）。Settings → 插件 → Inject 的 `session://*` 与上列一一对应（`skill.list` / `skill.read`）。seed AGENTS / skills 仍走 inject。子会话不吃 posture/board 全板（authority / capability / seat 仍可有）。委派用 `subagent member_id`，别贴 playbook。

**一事一处：** ask 只在 capability；MCP **用法**看 `mcp_mount`，**配置**仍在向阳。

**工具预审（Auto-review）**不靠 fragment 刷屏：`/permission auto` = 无沙箱 + 每调用评审。Host 把 Settings / `/auto-review` 接到 `createAutoReviewToolPre`（启发式 · HTTP · 会话 LLM；deny 默认 ask→审批；技术失败默认 `onClassifierError:'ask'`，可 `'deny'` fail-closed）。见 [configuration.md](./configuration.md) · [status.md](./status.md)。

## 范围

本仓交付可插拔 **section + budget** 收集管线（marked additional_context · recap）。工具预审走 auto-review，不在本包。

相关：[workspace-inject.md](./workspace-inject.md) · [status.md](./status.md)

---

# Context fragments

> **Audience**: Contributors · Integrators

**Context fragments** = phase-collected, recomputable model-visible context. Keep them **apart** from durable workspace inject (`skill-catalog` / `agent-instructions`): standing copy stays on inject; hot copy stays on fragments.

| Channel | Package | When | `user/message.source` |
|---------|---------|------|------------------------|
| Workspace inject | `@xrkseek/workspace` | Standing inject on disk change | `skill-catalog` · `agent-instructions` |
| Fragments | `@xrkseek/context-fragments` | Recomputable each turn / user message | `context-fragment` |
| Session recall | `@xrkseek/xrk-session-reference` | `@session` prepare | `session-reference` |
| Mid-tool | `deferContext` | After tool results | plain text (no typed source) |

Do not move AGENTS.md / skill catalogs into fragments; do not put ephemeral env / recap into inject.

**In-window last-wins:** each turn still appends a `user/message` (full log retained); the model window keeps **only the latest** row per `fragmentId`, so permission / seat / routing copy does not stack stale snapshots.

**Two axes:** delivery channels (system · durable · fragment · tools[] · derive) may differ; living prose uses fragment semantics (stable id · recompute · last-wins). Keep `tools[]` thin (name · short description · JSON schema)—do not fragment the whole catalog. Layer sketch: Cursor Canvas `context-engineering-layers`.

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

Host **turn-start** (high→low): `instruction_authority` · `session_capability` (`mcp_mount` / `ask:`) · `session_posture` (IM/奇创/harness·shallow; empty for Frugal/Shell) · `boss_status` · `seat_identity` · `collab_board` (roster ids + recent 主线; one same-lane spout; long dispatch chains stay in posture). Settings → Plugins → Inject `session://*` mirrors that set (`skill.list` / `skill.read`). Seed AGENTS / skills stay on inject. Children skip full posture/board (authority / capability / seat may still appear). Spawn with `subagent member_id`; do not paste playbooks.

**One fact one place:** ask stays on capability; MCP **usage** is `mcp_mount`, **config** stays on Xiangyang.

**Tool pre-review (Auto-review)** is not fragment spam: `/permission auto` = no sandbox + per-call review. Host wires Settings / `/auto-review` to `createAutoReviewToolPre` (heuristic · HTTP · session LLM; deny defaults ask→approval; technical failures default `onClassifierError:'ask'`, or `'deny'` fail-closed). See [configuration.md](./configuration.md) · [status.md](./status.md).

## Scope

This repo ships the pluggable **section + budget** collection pipeline (marked additional_context · recap). Tool pre-review is auto-review elsewhere, not this package.

Related: [workspace-inject.md](./workspace-inject.md) · [status.md](./status.md)
