# 会话身份与协作边界

> **读者**：集成者 · 贡献者（模型面协作契约）

会话 **badge**（tool_surface）和工作区是两条正交轴。Face 再派生工程身份 `kind`，管编排权、交付契约、互聊动词。用户用自然语言「许愿」时，按当前身份选工具，别猜。

## 五种工程身份

| 身份 `kind` | 典型落点 | 编排权 | 交付契约 | 互聊动词 |
|-------------|----------|--------|----------|----------|
| **orchestrator** | 奇创 `qichuang` · IM `im` | 跨工作区派活、名册、主线钉 | 不自己实现；结果在编码 peer | `workspace_*` · `thread_message` ·（IM）`subagent(workspace_id)` |
| **coding_parent** | 编码区父会话（harness / shallow / frugal…） | 本仓 spawn + 任务板 + 名册 | 对人负责 | `subagent` · `list_agents` · `team_graph` · `thread_*` |
| **delegated_child** | `subagent` / `member_id` 干员 | 无（`lead` 可弱编排） | FINAL 助手消息 → 父工具结果 | `thread_message` sibling / peer · `team_list` + `team_self`（有 `member_id`） |
| **peer_parent** | 其它父会话（含 `workspace_session_prompt` 开出的）· **干员家身份席** | 自管本会话 | 对催办方 `thread_message` 回复；身份席另可 `team_self` | 全量父工具（按其 badge）；**身份席**名册面 = `team_list` + `team_self`（不铸包/删别人） |
| **fork_clone** | UI rewind fork | 同父工具面 | 独立对话，不占子代理 depth | 同 coding_parent（非 delegated） |

`kind` 是**派生事实**，不是新的 badge id。

## 硬边界

1. **奇创 = orchestrator**，永不 nested `subagent`；实现落编码 peer。
2. **IM = channel orchestrator**；实现落编码工作区，不在 `ws_im` 改业务仓。
3. **delegated_child** 保留产品站立（`~/.xrk`），跳过家约定草稿（`~/.agents`）；席位身份来自 spawn 前缀 + turn-start 短 `<session_capability>` + 小队板。
4. **主线**是发现钉，不是发信门槛；任意父会话可 `thread_message` 另一父会话。
5. **父↔子**用 `send_message` / `followup_task`；**子↔子**与**对等父**用 `thread_message`。
6. 干员看见**同父小队**与自身任务，不看见全仓主线 / global 编排板。
7. **名册自改**：`team_self` 属于「我是谁」——`subagent(member_id)` 子会话与**干员家身份席**都有；铸包/安装/卸载仍在向阳·IM·编码经理的全量 `team_*`。
8. **会话协作回传**与子代理 courier 同纪律：`wait:true` 成功只走工具结果；`wait:false` / 超时 / Stop 走异步 steer（idle 完成 vs stop 带部分答），同 stretch 不丢不重。

## turn-start 注入分工

| Fragment | 谁有 | 作用 |
|----------|------|------|
| `<session_capability>` | 父会话：permission × tool_surface × **model/modality** × `mcp_mount` × `ask:`；干员：`kind=delegated_child` 短块（同带 model/modality / mcp / ask） | 自己是谁（事实真源） |
| `<session_posture>` | IM / 奇创 / harness·shallow 经理；**Frugal / Shell 空**（无 spawn；见 `surface_brief`） | 派活动词卡（不复述 capability） |
| `<session_lanes>` | 所有有会话的席（含子会话） | 本会话主线 / 支线 / open todos；完成后切换动词 |
| `<seat_identity>` | 各员工席 | 谁你是 / `report`·`ui` / peer；席位词跟 Settings **titles**；子代理另有 `lane`（manager-kind spawn ≠ agent-kind 家） |
| `<external_collab_board>` | 父会话：名册 + 主线 / 未钉 peers；干员：小队板 | 看见谁（ids）；同道一句，长链在 posture |
| spawn preamble | 干员（首轮任务文本） | 身份 + FINAL 交付 |

每回合两行：`model:` / `modality:`。文本路由：像素不上线、别瞎编；多模态才走 vision。工具与 guidance 同契约。

**一事一处：** ask → capability；派活长链 → posture；主线/支线/todo → `<session_lanes>`；board → ids + 同道。

协作工具描述走 `dynamicSchema`，文案集中在 `session-tool-copy.ts`（按 `kind` 重写 `thread_message` 等）。静态 `description` 只留短契约。同父干员 attach 时自动 `peer`（`label=sibling`，手改标签保留）。走查：[session-identity-scenarios](./session-identity-scenarios.md)。

## 表面层工具 vs 工具面

两层不要混：

| 层 | 是什么 | 不是什么 |
|----|--------|----------|
| **工具面** `tool_surface` / badge | 本席**绑哪些工具名**（harness / IM / 奇创 / frugal…） | 不是「某个工具今天有没有额外文案」 |
| **表面层工具** | **场景绑定**才出现或才可用的工具：`team_self`（身份席 / `member_id` 干员）、TTS/ASR（语音通道）、MCP 挂载工具（`mcp_mount` 活着才有） | 不是新的 badge id，也不是往 `tools[]` 里灌整份 catalog |

设计纪律（对照 DSH 前缀缓存）：

1. **绑定门**决定工具在不在表里；**fragment** 承载活事实（名册 ids、小队、MCP 用法一句）。
2. `tools[]` 只留薄契约（name · 短 description · JSON schema）；**禁止**把 sibling ids / 名册行写进 description——一变就整段工具前缀 miss。
3. 真要扩工具面，改 preset / Face bind，不要发明第二个 `tool_surface` 枚举当「表面层」。

相关：[context-fragments](./context-fragments.md) · [session-optimize](./session-optimize.md) §5。

### Codex morph（对照 `.tmp/compare`）

| Codex | 本仓 |
|-------|------|
| `send_input` | `send_message`（`delivery=steer`） |
| `resume_agent` | `followup_task`（闲置新任务）或 `send_message`（中途插话） |
| `close_agent` | **`close_agent`**（interrupt + 末轮助手快照） |
| `interrupt_agent` | `interrupt_agent`（只停，不回快照） |

## 两类工作区（产品轴）

侧栏区名与三级身份词均跟 Settings **titles**（`老板` / `经理` / `干员` 可改）。下表用 **manager-kind / agent-kind** 指类，活词见 `<seat_identity>` `titles:`。

| 类 | 含谁 | 典型用户动作 | 模型该做 | 不该做 |
|----|------|--------------|----------|--------|
| **manager-kind** | 向阳（向日葵）· 各编码仓 | 配 Host / 开席 / 改项目 | 向阳：编排推给 peer coding；编码：本席 ship + `subagent` | 向阳代写产品；编码自建/删 WS |
| **agent-kind** | agent-home | 专长；人机面直聊 | 跟 playbook；peer 仅 agent-kind + 向阳 | 当 manager-kind 改业务仓 |

编码仓与向阳同属 manager-kind，互为 peer lead。名册成员 ≠ agent-kind 家；开家显式（`team_home` / UI）。manager-kind 上 `subagent` 的子会话：cwd=父项目，`lane` 标明 **not** agent-kind 家；**无** `workspace_*` / TTS·ASR。

**创建者 vs 委派方：** TTS/ASR 只挂**老板创建**的席（无 `opener`）；席位开出的 peer / 子代理永不挂语音——老板事后发言只改 `ask:`，不改语音。工具面全表：产品 skill `xrk-tool-surfaces`。

## 许愿 → 动词

| 用户意图（例） | 当前身份 | 首选动词 | 不该做 |
|----------------|----------|----------|--------|
| 组名册 / 加干员 | orch / coding_parent | `team_save` / `team_import`；（要家）`team_home` | `propose_skill` 冒充干员；就绪顺便铸家 |
| 开专长家 / 老板直聊干员 | qichuang 或侧栏 | `team_list` → `team_home` → `workspace_session_prompt` | 无故再 mint advanced；`workspace_create` 冒充家 |
| 项目内并行拆片 | coding_parent | `subagent member_id` | 为专长任务硬开第二个家 |
| 让两干员商量 | coding_parent 已 spawn | 干员侧 `thread_message`；或父 `send_message` | 干员再 `subagent` |
| 向阳里改某编码仓 | qichuang | `workspace_list` → `workspace_session_prompt` 其它经理 | 在向阳 cwd 大改 monorepo |
| IM 里开工 | im | `subagent(workspace_id)` 或 `workspace_session_prompt` | 在 IM 写业务代码 |
| 干员卡住 / 接管 | coding_parent | takeover · `interrupt_agent` / `close_agent` · 再 spawn | 非 lead 改名册 |

相关： [host-face](./host-face.md) · [status](./status.md) · [profiles](./profiles.md) · [learn](./learn.md)。

---

# Session identity and collaboration boundaries

> **Audience**: Integrators · contributors (model-facing collab contract)

Session **badge** (tool_surface) and workspace are orthogonal. Face also derives an engineering identity `kind` that governs orchestration rights, delivery contract, and messaging verbs. When the user states an intent in natural language, the model should pick tools from its current identity — not guess.

## Five engineering identities

| Identity `kind` | Typical surface | Orchestration | Delivery | Messaging verbs |
|-----------------|-----------------|---------------|----------|-----------------|
| **orchestrator** | Qichuang `qichuang` · IM `im` | Cross-workspace dispatch, roster, 主线 pins | Do not implement here; results live on coding peers | `workspace_*` · `thread_message` · (IM) `subagent(workspace_id)` |
| **coding_parent** | Coding parent (harness / shallow / frugal…) | In-workspace spawn + task board + roster | Accountable to the human | `subagent` · `list_agents` · `team_graph` · `thread_*` |
| **delegated_child** | `subagent` / `member_id` 干员 | None (`lead` may lightly coordinate) | FINAL assistant message → parent tool result | `thread_message` sibling / peer · `team_list` + `team_self` (when `member_id`) |
| **peer_parent** | Another parent (incl. `workspace_session_prompt`) · **agent-home identity seats** | Owns its own session | Reply via `thread_message`; identity seats also `team_self` | Full parent tools for its badge; **identity seats** roster = `team_list` + `team_self` (no mint/remove of others) |
| **fork_clone** | UI rewind fork | Same parent tool surface | Independent chat; does not consume subagent depth | Same as coding_parent (not delegated) |

`kind` is a **derived fact**, not a new badge id.

## Hard boundaries

1. **Qichuang = orchestrator** — never nested `subagent`; implement on coding peers.
2. **IM = channel orchestrator** — implement in coding workspaces, not inside `ws_im`.
3. **delegated_child** keeps product standing (`~/.xrk`) and skips home convention drafts (`~/.agents`); seat identity = spawn preamble + turn-start short `<session_capability>` + teammate board.
4. **主线** is a discovery pin, not a messaging gate; any parent may `thread_message` any parent.
5. **Parent↔child** uses `send_message` / `followup_task`; **child↔child** and **parent↔parent** use `thread_message`.
6. Children see their **same-parent squad** and own task — not the full workspace 主线 / global orchestration board.
7. **Roster self-revise**: `team_self` is identity — both `subagent(member_id)` children and **agent-home identity seats** get it; mint/install/remove stay on Xiangyang · IM · coding-manager full `team_*`.
8. **Session-collab report-back** matches subagent courier discipline: `wait:true` success stays in the tool result; `wait:false` / timeout / Stop use async steer (idle completion vs stop with partial answer) — one channel per stretch.

## Turn-start inject roles

| Fragment | Who | Role |
|----------|-----|------|
| `<session_capability>` | Parents: permission × tool_surface × **model/modality** × `mcp_mount` × `ask:`; children: short `kind=delegated_child` (same model/modality / mcp / ask) | Who am I (source of truth) |
| `<session_posture>` | IM / Qichuang / harness·shallow managers; **empty for Frugal / Shell** (no spawn — see `surface_brief`) | Dispatch verb card (no capability re-lecture) |
| `<session_lanes>` | Every live seat (including children) | This session’s 主线 / 支线 / open todos; completion-switch verbs |
| `<seat_identity>` | Employee seats | Who you are / `report`·`ui` / peers; seat words follow Settings **titles**; subagents also get `lane` (manager-kind spawn ≠ agent-kind home) |
| `<external_collab_board>` | Parents: roster + 主线 / unbound peers; children: teammate board | Who is here (ids); one same-lane spout — long chains stay in posture |
| Spawn preamble | Children (first task text) | Identity + FINAL delivery |

Each turn: `model:` / `modality:`. Text-only keeps pixels off the wire — do not invent; multimodal may use vision. Tools and guidance share that contract.

**One fact one place:** ask → capability; dispatch chains → posture; 主线/支线/todo → `<session_lanes>`; board → ids + same-lane spout.

Collab tool copy lives in `session-tool-copy.ts` via `dynamicSchema` (rewritten from live `kind`). Static `description` stays short. Same-parent siblings auto-link as `peer` on attach (`label=sibling`; custom labels kept). Walkthrough: [session-identity-scenarios](./session-identity-scenarios.md).

## Scenario-bound tools vs tool_surface

Keep these two layers apart:

| Layer | What it is | What it is not |
|-------|------------|----------------|
| **Tool surface** `tool_surface` / badge | Which tool **names** this seat binds (harness / IM / Qichuang / frugal…) | Not “extra copy on a tool today” |
| **Scenario-bound tools** | Tools that appear or unlock only in a scenario: `team_self` (identity seat / `member_id` child), TTS/ASR (voice channel), MCP-mounted tools (while `mcp_mount` is live) | Not a new badge id, and not a full catalog stuffed into `tools[]` |

Rules (provider KV prefix; DSH parity):

1. **Binding** decides membership; **fragments** carry live facts (roster ids, squad, one-line MCP usage).
2. Keep `tools[]` thin (name · short description · JSON schema)—**never** put sibling ids / roster rows in descriptions (one change misses the whole tools prefix).
3. To widen the surface, change preset / Face bind—do not invent a second `tool_surface` enum for “scenario layer”.

See [context-fragments](./context-fragments.md) · [session-optimize](./session-optimize.md) §5.

### Codex morph (from `.tmp/compare`)

| Codex | This repo |
|-------|-----------|
| `send_input` | `send_message` (`delivery=steer`) |
| `resume_agent` | `followup_task` (idle new task) or `send_message` (mid-turn) |
| `close_agent` | **`close_agent`** (interrupt + last-assistant snapshot) |
| `interrupt_agent` | `interrupt_agent` (stop only, no snapshot) |

## Two workspace kinds (product axis)

Sidebar labels and the three seat words follow Settings **titles** (defaults boss / manager / agent). Table uses **manager-kind / agent-kind**; live words are on `<seat_identity>` `titles:`.

| Kind | Who | Typical human move | Model should | Must not |
|------|-----|--------------------|--------------|----------|
| **manager-kind** | Xiangyang (Sunflower) · coding repos | Host config / open seats / ship a project | Xiangyang: route to peer coding; coding: ship + `subagent` | Xiangyang shipping product; coding creating/deleting WS |
| **agent-kind** | agent-home | Specialty; human face speaks | Follow playbook; peer agent-kind + Xiangyang only | Act as manager-kind on a product repo |

Coding and Xiangyang are both manager-kind — peer leads. Roster member ≠ agent-kind home; minting a home is explicit (`team_home` / UI). A `subagent` under manager-kind keeps parent cwd; `lane` marks **not** agent-kind home; **no** `workspace_*` / TTS·ASR.

**Creator vs delegator:** TTS/ASR mount only on **boss-created** seats (no `opener`). Seat-opened peers and children never get voice — later boss speech flips `ask:` only. Full tool map: product skill `xrk-tool-surfaces`.

## Intent → verbs

| User intent (examples) | Current identity | Prefer | Avoid |
|------------------------|------------------|--------|-------|
| Roster / add a 干员 | orch / coding_parent | `team_save` / `team_import`; (`team_home` when a home is needed) | `propose_skill` as a 干员; minting home on ready |
| Open specialty home / boss chats 干员 | qichuang or sidebar | `team_list` → `team_home` → `workspace_session_prompt` | Minting another advanced; faking home with `workspace_create` |
| Parallel slices inside a project | coding_parent | `subagent member_id` | Opening a second home for a project slice |
| Have two 干员 discuss | coding_parent after spawn | Child `thread_message`; or parent `send_message` | Child nesting `subagent` |
| Edit a coding workspace from Xiangyang | qichuang | `workspace_list` → `workspace_session_prompt` coding manager | Large monorepo edits in Xiangyang cwd |
| Start work from IM | im | `subagent(workspace_id)` or `workspace_session_prompt` | Implementing product code in IM |
| Stuck child / takeover | coding_parent | Takeover · `interrupt_agent` / `close_agent` · respawn | Non-lead editing the roster |

See also: [host-face](./host-face.md) · [status](./status.md) · [profiles](./profiles.md) · [learn](./learn.md).
