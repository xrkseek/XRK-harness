---
name: xrk-inject-layer
description: 定位「要改 AI 行为口径该写在哪一层注入」的分层地图：家站立/约定/工作区覆盖/catalog playbook/内核 persona 的优先级，以及 audience 只跳过家约定草稿（产品 ~/.xrk 全席保留）的坑。
---

# Where to change agent-facing wording

XRK-Harness injects operator text from several layers, and **each layer reaches a different set of sessions**. Picking the wrong layer produces a change that passes review, ships, and silently does nothing.

**全栈对接图（通道 × 内容单元 · 席位 · 工具文案落差 · 待拍板项）：** 打开 Cursor Canvas `context-engineering-layers`。约定：注入**通道**可不同，活**文案**按碎片语义统一管理（稳定 id · 重算 · 窗内 last-wins）；`tools[]` 只留薄契约。教科书：`docs/workspace-inject.md` · `context-fragments.md` · `curated-memory.md` · `session-compaction.md` · `skills-layers.md`。

## When to use

- User says: 「让 AI 别拒绝 / 别加免责 / 更听话 / 认知冲突」「学某个插件的提示词」「全局提示词该写哪」「为什么改了 AGENTS.md 没效果」「干员不遵守规矩」
- Adding or weakening any instruction-authority, refusal-hedging, or tone contract.
- Auditing whether a seed/persona edit reaches subagents, IM, or 向阳.

## Procedure

### 1. Map the target to a layer (never skip this)

| Layer | Path | Reaches | Refresh |
|---|---|---|---|
| Home product standing | `apps/cli/seeds/standing/{AGENTS,SOUL}.md` → `~/.xrk/` | **every** audience (coding / IM / 向阳 / 干员家 / 子代理) | fingerprint — bundled copy **overwrites** `~/.xrk` on Host establish |
| Home convention | `~/.agents` · `~/.claude` · `~/.codex` (`HOME_CONVENTION_INJECT`) | **every** audience | user-owned, never overwritten |
| Manager ledger | `~/.xrk/XRK.md`（站立种子 · fingerprint 同 AGENTS）· `{ws}/.xrk/XRK.md` · 遗留 `~/XRK.md` · `{root}/XRK.md` | **parent** (`audience=user`：经理 · 向日葵 · 经理特调) only — **not** 干员家 / 委派子会话 | seed fingerprint + user overlay |
| Workspace convention | `{root}/.agents/` · `.claude/` · `.cursor/rules/` · `.codex/` · `CODEX.md` · `.github/` | **all audiences** on that cwd — **each present vendor attempted** (multi-agent same-repo; not mutually exclusive) | user-owned |
| Workspace product | `{root}/.xrk/` (SOUL/IDENTITY/USER/TOOLS/AGENTS …) | same — alongside convention vendors | user-owned |
| Workspace root | `{root}/AGENTS.md` · `CLAUDE.md` | same — **also** attempted with every overlay; opt out with `xrk-inject: false` | user-owned |
| Catalog / custom playbook | roster → synced to agent-home `AGENTS.md` | 干员家 + 其子代理（via cwd AGENTS） | seed re-merge / `team_save` |
| Kernel persona | `presets/harness/preset.ts` `persona` | every harness session (system, not durable inject) | needs a release |
| Turn-start fragments | Face providers (instruction_authority · capability · posture · boss · seat · collab) | per seat / always for authority card | every turn |

Precedence is **low → high in output order**. **Three surfaces stay separate:**

| Surface | Controls | Does **not** control |
|---|---|---|
| Context inject | standing · convention · catalog · fragments | tools / permission |
| Tool runtime | badge · seat bind list | what text is injected |
| Permission / policy | Host hard-block on tool calls | inject content |

### 2. Subagents / 干员家

Host sets `audience = "subagent" | "minimal"` for children and 干员家 — that **only skips manager ledger `XRK.md`**. Standing + home convention + workspace convention + skill trees still inject.

| Word | Means |
|---|---|
| `minimal` (roster inject / lean seat) | Historically named for lean catalog; **now same context as parents** minus `XRK.md`. Badge Frugal = **tools**, not inject. |
| `subagent` | The **spawn tool** + child session. Same context rule as above. |

**Progressive disclosure:** skill catalog lists name+blurb; `skill` loads the body. Do not skip convention files to “save” context.

**Authority lanes:** `<instruction_authority>` from `createInstructionAuthorityRegistry` — plugins `register({ id, lane: "order"|"data", label })`. Soft “FYI” text cannot move an `order` into `data`.

**Tool-surface map (经理 / 向阳 / IM):** Canvas `context-engineering-layers`.

### 3. Verify the change actually lands

- Seed edit → `pnpm vitest run apps/cli/tests/user-skill-seeds.test.ts packages/workspace/tests/ecosystem-instructions.test.ts`
- Roster edit → `packages/server/face/tests/agent-roster-store.test.ts` (+ `collab-board`, `session-capability` read the roster)
- Check what tests pin: seed tests assert `toContain(...)` on **substrings**, so pure additions are safe; playbook tests assert `toContain("workspace researcher")` — prefix, don't replace.
- Confirm budget headroom: inject cap is 32 000 chars (`workspace-inject.injectMaxChars`) shared by rules + skill catalog.
- Live check the rendered text: `session_inspect` / read `~/.xrk/AGENTS.md` after an establish, or the roster jsonl under `~/.xrk/agent-rosters`.

### 4. Reject the tempting-but-wrong targets

- **Do not add escalation language** ("request more access freely"). Permission mode is a user-facing product choice (`/permission`, Settings); approval-policy copy is test-pinned. Authority wording must scope to *executing the task*, never to *changing the runtime gate*.
- **Do not write unconditional "never refuse".** `auto-review-classifier.ts` carries hard-deny rules that must survive ("even when a human explicitly requests"). Bound it: the only "no" is a Host block; name it, route around it, keep going — without laundering it into self-censorship.
- **Do not blanket-suspend "untrusted".** Tool contracts (`web_fetch`, `web_search`, `session_read`, a2a inbound) say data-not-instructions and have tests. Narrow the authority to operator-authored input; foreign content keeps its boundary.
- **Never edit `~/.xrk/AGENTS.md` by hand** expecting persistence — the fingerprint refresh overwrites it.
- **Do not put SOUL under `.agents/`** expecting inject — persona files only load from `.xrk/` product standing.

## Pitfalls

- **`apply_edit` can mangle replacement text containing `${...}` template syntax** — it silently deleted a whole object property (observed: diff showed `1 insertion, 3 deletions`). For structured/multi-site source edits: `git checkout --` the file, then a Node script with regex + an explicit expected-match count that throws on mismatch. Verify with `git diff` before moving on.
- "Works in my chat" ≠ "reaches 干员 seat playbook". Product standing reaches them; member role still needs playbook.
- Workspace **`.agents` · `.claude` · `.cursor/rules` · `.codex` · root AGENTS · `.xrk`** all inject when present (deduped) — multi-agent same-repo. Don't keep the same handbook in N places; use `xrk-inject: false` for maintainer-only root notes.
- Home `~/.cursor/**` is never injected; workspace `.cursor/rules/` is (`inject-sources.ts` profiles).
- `memory` targets (`memories/USER.md`, `MEMORY.md`) are curated memory, not standing inject — a wording change there does not become a behavioral contract.
