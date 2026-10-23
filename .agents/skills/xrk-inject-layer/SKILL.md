---
name: xrk-inject-layer
description: 定位「要改 AI 行为口径该写在哪一层注入」的分层地图：家站立/约定/工作区覆盖/catalog playbook/内核 persona 的优先级，以及子会话 audience 跳过家站立导致站立改动对干员无效的坑。
---

# Where to change agent-facing wording

XRK-Harness injects operator text from several layers, and **each layer reaches a different set of sessions**. Picking the wrong layer produces a change that passes review, ships, and silently does nothing.

## When to use

- User says: 「让 AI 别拒绝 / 别加免责 / 更听话 / 认知冲突」「学某个插件的提示词」「全局提示词该写哪」「为什么改了 AGENTS.md 没效果」「干员不遵守规矩」
- Adding or weakening any instruction-authority, refusal-hedging, or tone contract.
- Auditing whether a seed/persona edit reaches subagents, IM, or 向阳.

## Procedure

### 1. Map the target to a layer (never skip this)

| Layer | Path | Reaches | Refresh |
|---|---|---|---|
| Home standing | `apps/cli/seeds/standing/{AGENTS,SOUL}.md` → `~/.xrk/` | coding / IM / 向阳 **parent** sessions only | fingerprint — bundled copy **overwrites** `~/.xrk` on Host establish |
| Home convention | `~/.agents/AGENTS.md`, `~/.xrk/{TOOLS,IDENTITY,USER,assistant}.md` | same, when file exists | user-owned, never overwritten |
| Workspace convention | `{root}/.agents/`, `.claude/`, `.cursor/rules/`, `.codex/` | that workspace | user-owned |
| Workspace product | `{root}/.xrk/` | that workspace | user-owned |
| Workspace root | `{root}/AGENTS.md` | that workspace — **suppressed** if `.xrk/AGENTS.md` or `.agents/AGENTS.md` exist | user-owned |
| Catalog playbook | `packages/server/face/src/agent-roster-store.ts` → `seedGlobalRosterMembers()` | built-in 干员 | source edit re-applies on every roster load |
| Custom playbook | `team_save` playbook text | that member | member-scoped |
| Kernel persona | `presets/harness/preset.ts` `persona` (`options.system`, unset by Host) | every harness session | needs a release |

Precedence is **low → high in output order** (`collectEcosystemInstructions` header comment): later sections sit closer to the turn and win.

### 2. Decide for subagents separately — the classic trap

Delegated children **never** see home standing. `packages/server/host/src/index.ts` (`resolveAgent`) forces `audience = "subagent" | "minimal"` whenever `parentSessionId` exists; `ecosystem-instructions.ts` then guards the whole home block with `if (includeUserHome && !isSubagent)`. This is deliberate — `docs/workspace-inject.md` ("子代理 audience") and the child identity comes from the Face spawn preamble.

Consequence: an authority/tone paragraph added to standing has **zero** effect on 干员. The only operator-authored text a child reliably reads is its **playbook**. Patch both, or patch the `xrk-delegate` playbook template so future members inherit it.

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

## Pitfalls

- **`apply_edit` can mangle replacement text containing `${...}` template syntax** — it silently deleted a whole object property (observed: diff showed `1 insertion, 3 deletions`). For structured/multi-site source edits: `git checkout --` the file, then a Node script with regex + an explicit expected-match count that throws on mismatch. Verify with `git diff` before moving on.
- "Works in my chat" ≠ "reaches 干员". Verify the audience, not just the file.
- Root `AGENTS.md` silently stops injecting once a workspace product/`.agents` overlay exists — rules written there can vanish after someone adds `.agents/AGENTS.md`.
- Home `~/.cursor/**` is never injected; workspace `.cursor/rules/` is (`inject-sources.ts` profiles).
- `memory` targets (`memories/USER.md`, `MEMORY.md`) are curated memory, not standing inject — a wording change there does not become a behavioral contract.
