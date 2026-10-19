# 会话身份场景走查

> **读者**：集成者 · 贡献者

同一契约在不同身份上的**分步走查**。会话 / 工作区 id 为示意。每段写清：用户原话 → 该身份 turn-start **实际注入**（摘录）→ `dynamicSchema` 后工具句 → 工具调用序列（含关键参数）→ 各方可见面 → 反模式。定义见 [session-identity](./session-identity.md)；文案实现见 `packages/server/face/src/session-tool-copy.ts`。

## 共享角色卡

| Id | 角色 |
|----|------|
| `ws_default` | 向阳空间（奇创） |
| `ws_im` | IM 工作区 |
| `ws_code` | 编码仓 A（path=`~/proj/a`） |
| `ws_docs` | 编码仓 B（path=`~/proj/docs`） |
| `sess_xy` | 奇创父会话 |
| `sess_im` | IM 父会话 |
| `sess_code` | 编码父会话（harness） |
| `sess_docs` | 另一编码父会话（peer） |
| `sess_scout` | 干员 · researcher · `mem_seed_researcher` |
| `sess_build` | 干员 · worker · `mem_seed_worker` |
| `task_inject` | 任务板行：补注入目录 |

---

## 场景 A · 奇创编排到编码 peer

**用户**（在 `sess_xy`）：「组个调研和施工，去编码仓把注入目录补上。」

### A1 · `sess_xy` 看见什么

身份：`orchestrator`（`qichuang`）。**无** `subagent` 工具。

`<session_capability>` 摘录：

```
badge: qichuang
tool_surface: qichuang (full-access · team+list/create/session_prompt+thread · no nested subagents)
surface_brief: kind=orchestrator · surface=qichuang · path=open (fs incl. grep/glob) — verbs in <session_posture>.
```

`<session_posture>` 摘录：

```
kind=orchestrator (Qichuang) · path=open · shell_confine=off
Vague → skill xrk-demand-translate. Care: …
Dispatch: workspace_session_prompt → keep session_id → thread_message; optional thread_upsert + presence_set.
No nested subagent. Implement on coding peers only.
```

`<external_collab_board>` 摘录：

```
Roster · 主线 · peers. No nested subagent — match member, then workspace_session_prompt → thread_message …
- mem_seed_researcher [global] 调研员 · researcher · inject=minimal · …
- mem_seed_worker [global] 施工员 · worker · inject=minimal · …
主线 (24h) — …
(none)
```

动态工具句（materialize 后）：

| 工具 | 关键句 |
|------|--------|
| `workspace_list` | `No nested subagent — workspace_session_prompt → keep session_id → thread_message.` |
| `workspace_session_prompt` | `Qichuang peer only — no nested subagent. Implement there.` |
| `thread_message` | `Message another parent session by session_id …` |
| `team_list` | 附 live 名册；可 `team_save` |

### A2 · 工具序列

1. （可选）`team_list` — 确认 `mem_seed_*` id。
2. `workspace_list` → 找到 `ws_code`。
3. `workspace_session_prompt`：
   - `workspace_id=ws_code`
   - `prompt`：说明要调研结论 + 施工改注入；点名可后续在 peer 上 `subagent member_id=…`
   - `wait=true`
4. 结果含 `sessionId=sess_code`。
5. （可选）`thread_upsert`：`session_id=sess_code`，标题「注入目录」。
6. 后续催办：`thread_message` `{ session_id: sess_code, message: "…" }`。

实现发生在 **`sess_code`（coding_parent）**，不是 `sess_xy`。

### A3 · 反模式

- 在 `sess_xy` 调 `subagent`（工具表无 / 契约禁止）。
- 在向阳 cwd 大改 monorepo。
- `propose_skill` 冒充干员（应用 `team_save`）。

---

## 场景 B · 编码父会话并行派两干员

**用户**（在 `sess_code`）：「让调研和施工一起做，做完对一下。」

### B1 · `sess_code` 看见什么

身份：`coding_parent`。**有** `subagent` / `list_agents` / `send_message`。**无** `<session_posture>`。

协作板是名册 + 主线（不是小队板）。

`subagent` 动态句含：`Stay in this workspace — workspace_id / cwd are IM-only` + 当前名册。  
`send_message`：`Parent→child only`。  
`list_agents`：`Your direct children (not peer parents)`。

### B2 · 工具序列

1. `subagent`：
   - `member_id=mem_seed_researcher`
   - `description=调研注入`
   - `prompt=…`（完整路径 / 目标；不要叫孩子读 AGENTS.md）
   - `task_id=task_inject` 或同板 `task_name`
   - `run_in_background=true`（两人并行时）
2. `subagent`：`member_id=mem_seed_worker`，`prompt` 写明等调研结论或直接改，`task_id` 可共用或分任务。
3. 返回 `sess_scout` / `sess_build`。
4. 中途改口：`send_message` `{ agent_id: sess_scout, message: "…" }`（**不是** `thread_message`）。
5. `list_agents` / `wait_agent` 看进度。
6. 父只收两份 FINAL（或后台 steer 完成通知）。两人互相对齐 → 场景 C。

### B3 · 卡住 / 接管

- `interrupt_agent` 停一个孩子。
- Status 任务板 takeover → 人接管 → 再 `subagent`。
- 勿让非 lead 干员 `team_save`。

### B4 · 反模式

- 对 `sess_scout` 发 `thread_message`（父→子走 `send_message`）。
- 给子会话贴家目录 SOUL（spawn 已 `audience: subagent`）。
- coding 父传 `workspace_id` 跨仓（IM-only；执行会拒）。

---

## 场景 C · 干员施工与调研互聊

`sess_build` 已 spawn；任务「按调研结论改注入」。

### C1 · `sess_build` 看见什么

身份：`delegated_child`。

`<session_capability>` 摘录：

```
kind: delegated_child
parent: sess_code
you: sess_build
human_face: sess_code
role: worker
caps: edit,shell,read-fs
member_id: mem_seed_worker
brief: FINAL→parent (only visible result; include hard failures). ask→human_face. …
omitted: …
```

**无** posture；协作板是**小队板**：

```
squad · parent=sess_code · * = you
siblings → thread_message. Parent↔you = send_message / followup_task …
Teammates:
- sess_build* 「施工」 member=mem_seed_worker role=worker · running
- sess_scout 「调研」 member=mem_seed_researcher role=researcher · …
your_task: task_inject 「补注入目录」 status=in_progress
```

首轮用户消息另有 spawn preamble：`[subagent identity]` + Delivery + Task。

动态工具句：

| 工具 | 关键句 |
|------|--------|
| `thread_message` | `Live siblings: sess_scout.`（若已挂上） |
| `team_list` | `Read-only … team_save is parent/lead only` + 名册 |
| `session_inspect` | `Use ids from the turn-start squad board` |
| `list_agents`（若未 deny） | `Only children you spawned — teammates are on the squad board` |

worker **无** `subagent` / `team_graph`（角色 deny）。

### C2 · 工具序列（施工视角）

1. 读小队板 → 记下 `sess_scout`。
2. 缺事实：`thread_message` `{ session_id: sess_scout, message: "注入目录现状结论？" , wait: true }`。
3. 改文件 / 跑测。
4. （可选）`presence_set` `tips`＝支线字幕，**不是**交付。
5. FINAL 助手消息写给父（路径 · 证据 · 未做项）。父工具结果只看见 FINAL。

### C3 · `sess_scout` 对称

同样小队板（自己标 `*`）；researcher deny 写/shell；可 `thread_message` 回 `sess_build`；FINAL 交父。

### C4 · 反模式

- `team_save` / 嵌套 `subagent`。
- 把全仓主线当调度器（干员看不到主线板）。
- 把中间工具输出当交付（父看不见）。

---

## 场景 D · IM 频道开工

**用户**（在 `sess_im`）：「去 ws_code 那个仓修注入目录。」

### D1 · 看见什么

身份：`orchestrator`（`im`）。协作板 surface=im。`<session_posture>`：`kind=orchestrator (IM)`。

| 工具 | 动态关键句 |
|------|------------|
| `subagent` | `Cross-workspace: workspace_list then workspace_id` + 名册 |
| `workspace_session_prompt` | `From IM: this is a peer, not your child. Coding child linkage is subagent(workspace_id).` |
| `workspace_list` | `Prefer subagent + workspace_id … or workspace_session_prompt then thread_message.` |

### D2 · 两条合法路径

**父子树**：`workspace_list` → `subagent` `{ workspace_id: ws_code, member_id, prompt, inherit_context: false }` → 频道回一句进度。

**对等会话**：`workspace_session_prompt` `{ workspace_id: ws_code, prompt }` → 拿 `sess_code` → `thread_message`。

### D3 · 反模式

- 在 `ws_im` cwd 改业务仓。
- 对 peer 用 `send_message`（那是父→子）。
- coding 会话照抄 IM 的 `workspace_id` spawn。

---

## 场景 E · 两个父会话对齐措辞

`sess_code` 已开过 `sess_docs`（`ws_docs`）。**用户**：「你们两个把说明书措辞对一下。」

### E1 · 两边身份

均为父会话工具面（`coding_parent`；对端也可称 peer parent，**kind 派生同为 coding_parent / orchestrator 以外的父**）。各有名册+主线板，**无**小队板。

### E2 · 序列

1. （可选）`session_inspect` `{ session_id: sess_docs }` — 徽章 / presence / delivery。
2. `sess_code` → `thread_message` `{ session_id: sess_docs, message: "…" }`。
3. `sess_docs` 回复（同工具）。
4. 不 `thread_switch`；不把对方 `subagent` 掉。

### E3 · fork_clone

UI rewind fork：工具面同父；不占 subagent depth；不进小队板。

---

## 动词对照（速查）

| 意图 | 奇创 | IM | 编码父 | 干员 |
|------|------|-----|--------|------|
| 派实现 | `workspace_session_prompt` | `subagent(workspace_id)` 或 peer prompt | `subagent member_id` | — |
| 父→子跟进 | — | `send_message`（若用了 subagent） | `send_message` / `followup_task` | — |
| 对等互聊 | `thread_message` | `thread_message` | `thread_message` | — |
| 队友互聊 | — | — | — | `thread_message` sibling |
| 交付 | peer FINAL / 人 | 频道 + peer/child | 人可见 FINAL | FINAL → 父工具结果 |

---

# Session identity scenario walkthrough

> **Audience**: Integrators · contributors

Step-by-step walks of the **same contract** under each identity. Ids are illustrative. Each scene: user line → inject excerpts → post-`dynamicSchema` tool lines → tool sequence with args → who sees what → anti-patterns. Spec: [session-identity](./session-identity.md). Copy helpers: `packages/server/face/src/session-tool-copy.ts`.

## Shared cast

| Id | Role |
|----|------|
| `ws_default` | Xiangyang (Qichuang) |
| `ws_im` | IM workspace |
| `ws_code` / `ws_docs` | Coding workspaces |
| `sess_xy` / `sess_im` / `sess_code` / `sess_docs` | Parent sessions |
| `sess_scout` / `sess_build` | 干员 children |
| `task_inject` | Task-board row |

## Scene A · Qichuang → coding peer

User on `sess_xy`: “Stand up research and build; patch the inject docs in the coding repo.”

Sees `kind=orchestrator`, posture + roster board, **no** `subagent`. Dynamic `workspace_session_prompt` says peer-only. Sequence: `workspace_list` → `workspace_session_prompt(ws_code)` → keep `sess_code` → optional `thread_upsert` → `thread_message`. Implement on `sess_code`, not Xiangyang cwd.

## Scene B · Coding parent spawns two 干员

User on `sess_code`: “Have research and build work it together.”

Sees coding_parent board (roster + 主线). `subagent` stays in-workspace; `send_message` is parent→child. Spawn two `member_id`s (often `run_in_background`), follow with `send_message` / `list_agents` / `wait_agent`. Child–child talk is Scene C. Do not `thread_message` your own children.

## Scene C · Worker ↔ researcher

`sess_build` sees `kind: delegated`, squad board with `sess_scout`, optional `your_task`, spawn preamble. `thread_message` dynamic copy may list `Live siblings: sess_scout`. Ask scout → edit → FINAL to parent. No `team_save` / nested `subagent` for worker.

## Scene D · IM

User on `sess_im`: “Fix inject docs in ws_code.”

`subagent` allows cross-workspace `workspace_id`. Peer path: `workspace_session_prompt` then `thread_message`. Do not edit the product repo in `ws_im`.

## Scene E · Two parents align

Both parents; each has a roster/主线 board, not a squad board. `thread_message` either way; optional `session_inspect`. Never `thread_switch` just to talk; never turn the peer into a `subagent`. `fork_clone` keeps parent tools, skips subagent depth and squad board.

## Verb cheat sheet

| Intent | Qichuang | IM | Coding parent | 干员 |
|--------|----------|-----|---------------|------|
| Dispatch work | `workspace_session_prompt` | `subagent(workspace_id)` or peer prompt | `subagent member_id` | — |
| Parent→child follow-up | — | `send_message` if subagent | `send_message` / `followup_task` | — |
| Peer talk | `thread_message` | `thread_message` | `thread_message` | — |
| Squad talk | — | — | — | sibling `thread_message` |
| Deliverable | peer / human | channel + peer/child | FINAL to human | FINAL → parent tool result |
