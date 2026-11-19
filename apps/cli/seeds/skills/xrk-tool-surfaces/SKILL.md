---
name: xrk-tool-surfaces
description: >-
  Why a tool is or isn't on this seat: badge vs surface mounts (MCP≠badge),
  creator voice gate, Face binds, child deny. All seats may read — map only.
---

# Tool surfaces

Live: your `tools[]` + `<session_capability>` (`ask:` · `omitted` · `mcp_mount`). Titles → `<seat_identity>`.

## 工具面 vs 表面层

| | **工具面** badge | **表面层 / config mount** |
|--|------------------|---------------------------|
| Controls | Preset clusters for this seat | Host/Settings/plugins scene-bind |
| Examples | bash · skill · web/browser · lsp · pty · office · peer · subagent | `mcp__*` · voice · image/video · `memory` · `cronjob` · `computer_use` · sidebar `terminal_*` · `a2a_*` · `example_*` · community |
| Not | MCP on/off | A second badge id |

**MCP is never under badge.** Alive → `mcp_mount` + `mcp__*` (often deferred → `tool_search`). Roster allow cannot strip config-mount names. Wire MCP in 向阳/Settings (`xrk-capability-attach`).

## Who binds what

| Gate | Tools |
|------|-------|
| **Composition always** (coding) | `read_file` `write_file` `apply_edit` `apply_patch` `glob` `grep` `present` · `todo_write` · `working_directory` · `tool_search` · `ask_user` (Face may swap→`ask`) · Host also always: `session_search` `session_read` `session_trace` `session_event_window` `session_inspect` |
| **Badge `bash`** Shell+ | `bash` `job_list` `job_output` `job_kill` · optional `create_worktree` |
| **Badge `skill`** Shell+ | `skill` · `propose_skill` (Face confirm) |
| **Badge `web`** Frugal+ | `web_search` `web_fetch` · full `browser_*` (+ optional vault) |
| **Badge `lsp`** Frugal+ | `lsp` |
| **Badge `pty`** Shell+ | `terminal_open` `terminal_send` `terminal_read` `terminal_signal` `terminal_close` `terminal_list` — **≠** sidebar pack below |
| **Badge `office`** Frugal+ Face | `get_goal` `update_goal` · `canvas_*` · `presence_set` · full `team_*` (list modes below) |
| **Peer** shallow\|harness **or** IM/向阳 | `thread_*` · `workspace_list` `workspace_session_prompt` — **derived**, not a `tools.*` flag |
| **Subagent** Host when `subagents.on` | `subagent` `list_agents` `list_models` `send_message` `set_agent_model` `team_graph` `followup_task` `wait_agent` `interrupt_agent` `close_agent` (+`ralph` when bound) |
| **向阳 only** | `settings_get` `settings_mutate` · `workspace_create` · nested subagent **off** |
| **IM only** | `im_send` `im_reply` `im_binding` · no `ask_user` · Host subagent→coding · no presence/canvas |
| **Creator=老板** (no `opener`, not child) | Voice if Settings on: `text_to_speech` `voice_transcribe` `voice_session` |
| **Creator≠老板** (seat-opened / child) | Voice **stripped forever** (boss later speak flips `ask:` only) |
| **Surface mounts** | `image_generate` `video_generate` `video_analyze` · `computer_use` · `memory` · `cronjob` · `run_code` (when product on) · sidebar prefs: `sidebar_open` `terminal_create` `terminal_wait_for` `terminal_resize` (+ shared send/read/list/signal/close names) · `mcp__*` `a2a_*` `example_*` · community host tools |

Badge ladder: **PI** base only · **Shell** +bash/skill/pty · **Frugal** +web/lsp/office · **Shallow/Harness** +peer+subagent.

## Seat ask / team / child

| Seat | Ask | Team |
|------|-----|------|
| 向阳 / boss coding | `ask_user` + `answer_ask` | full `team_*` if office (向阳 always) |
| Seat-opened peer | `ask`→opener until humanSpoke, then `ask_user` | same as parent badge |
| Agent-kind home | same ask rule | `team_list` + `team_self` |
| Delegated child | `ask`→parent only | `team_list` (+`team_self` if member); ownLane `thread_*` only |

**Child deny** (`DELEGATED_INHERIT_DENY`): `ask_user` · `team_{save,import,ready,export,remove}` · `propose_skill` · `exit_plan_mode` · `settings_*` · `workspace_*` · `canvas_*`. No workspace orch on children. Role/member may strip more → `omitted`.

## Fragments (not tools)

`seat_identity` who · `session_capability` facts/ask/mcp · `session_posture` verbs · `collab_board` ids · `session_lanes` 主线/支线. Playbooks: `xrk-delegate` · `xrk-demand-translate` (向阳).

Missing? badge → creator → surface/`mcp_mount` → role omit. Don't invent names — trust `tools[]`.
