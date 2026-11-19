# 提示词工程

> **读者**：贡献者 · 维护者

模型可见文案落点。一事一处。

| 通道 | 真源 | 写什么 |
|------|------|--------|
| 站立 / 约定 | `apps/cli/seeds/standing/` · `.xrk/` · `.agents/` … | 手册与项目覆盖；[workspace-inject](./workspace-inject.md) |
| Skill catalog | 各 skills 根 | name + 一行；正文 `skill` 拉 |
| Fragments | Face providers | 席位 / 姿态 / 板 / 车道；[context-fragments](./context-fragments.md) |
| 工具 description | `session-tool-copy.ts` | 薄契约 |
| 工具结果 | handlers | 当轮事实 |

Turn-start：`session-capability.ts`（事实）· `session-posture.ts`（动词）· `collab-board.ts`（名册）。向阳细则：`xiangyang-skill-bodies/demand-translate.ts`。

**Catalog 卫生**：无可用 Provider / 密钥的生成类工具（`image_generate` · `video_generate` · `video_analyze`）与无 `XRK_LSP_COMMAND` 的 `lsp` **不进** `tools[]` / 对应引导句（对标 ASR listen）。配好 Settings·凭据后：`credentials/updated` 或 `settings/document-updated`（`image-gen` / `video-gen` / `video-analyze`）→ Host `invalidateAgents` **热重建**（忙会话等回合结束再换）。生成类 system 引导句只补 anti-pattern（禁 base64、attachmentId 地址），契约以工具 description 为准。见 [image-gen](./image-gen.md)。

**首轮省 token**（对照 Codex：契约在 tools[]，system/fragment 只 steer）：
- `tool:subagent` 独占委托；`surface-pack` 只报缺工具（全工具面为空）
- `<session_capability>`：无 UI `permission_label`；`gate` + 合并 `tool_surface`；`path_allowlist` 仅非零
- 空 `<session_lanes>` / 空 collab peers：一行 idle；有工作再展开
- fs/shell（含 jobs settle）/browser/authority/language/memory/session-query：短句；`web_family` 内含 search/fetch 契约（不再双挂）；形状与枚举留在工具 description

| 改什么 | 改哪里 |
|--------|--------|
| 全席手册 | `apps/cli/seeds/standing/AGENTS.md` |
| 向阳派活 | `demand-translate.ts`（升 revision） |
| 奇创 / IM 动词 | `session-posture.ts` |
| 工具句 | `session-tool-copy.ts` |
| 协作板 | `collab-board.ts` |
| 无钥不挂工具 | `presets/harness/preset.ts`（image/video/lsp 门控） |
| 首轮体量回归 | `presets/harness/tests/prompt-budget.test.ts` |

场景走查：[session-identity](./session-identity.md) · [session-identity-scenarios](./session-identity-scenarios.md)。

---

# Prompt engineering

> **Audience**: contributors · maintainers

Where model-visible copy lives. One fact, one place.

| Channel | Source | Holds |
|---------|--------|-------|
| Standing / conventions | `apps/cli/seeds/standing/` · `.xrk/` · `.agents/` … | Handbook / overlays — [workspace-inject](./workspace-inject.md) |
| Skill catalog | Skill roots | name + one-liner; body via `skill` |
| Fragments | Face providers | Seat / posture / board — [context-fragments](./context-fragments.md) |
| Tool description | `session-tool-copy.ts` | Thin contract |
| Tool results | Handlers | Turn facts |

Turn-start: `session-capability.ts` · `session-posture.ts` · `collab-board.ts`. Xiangyang playbook: `xiangyang-skill-bodies/demand-translate.ts`.

**Catalog hygiene**: generation tools without a usable Provider/key (`image_generate` · `video_generate` · `video_analyze`) and `lsp` without `XRK_LSP_COMMAND` are **not** registered into `tools[]` / guidance prompts (same idea as ASR listen). After Settings + Credentials, `credentials/updated` or `settings/document-updated` (`image-gen` / `video-gen` / `video-analyze`) → Host `invalidateAgents` **hot remount** (busy sessions wait for turn end). Generation system fragments only add anti-patterns; contracts live on tool descriptions. See [image-gen](./image-gen.md).

**First-turn diet** (Codex-style: contracts on tools[], system/fragments only steer):
- Delegation only in `tool:subagent`; `surface-pack` reports missing tools (empty when full)
- `<session_capability>`: no UI `permission_label`; `gate` + merged `tool_surface`; `path_allowlist` only when non-zero
- Idle `<session_lanes>` / empty collab peers: one line; expand when work exists
- fs/shell (incl. jobs settle) / browser / authority / language / memory / session-query: short; `web_family` owns search/fetch contracts (no double register); shapes/enums on tool descriptions

| Change | File |
|--------|------|
| Standing | `apps/cli/seeds/standing/AGENTS.md` |
| Xiangyang dispatch | `demand-translate.ts` (bump revision) |
| Qichuang / IM verbs | `session-posture.ts` |
| Tool copy | `session-tool-copy.ts` |
| Collab board | `collab-board.ts` |
| Gate keyless tools | `presets/harness/preset.ts` (image/video/lsp) |
| First-turn budget lock | `presets/harness/tests/prompt-budget.test.ts` |

Walkthroughs: [session-identity](./session-identity.md) · [session-identity-scenarios](./session-identity-scenarios.md).
