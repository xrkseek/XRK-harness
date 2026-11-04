---
name: xrk-curated-memory
description: >-
  Four-axis curated memory map under `{XRK_HOME}/memories` (global · workspace ·
  agent · session) — which zone a fact belongs in, how to audit and move entries
  between zones, and what must never be stored. Use when the user asks 「记忆放哪」
  「看看最近某工作区产生的记忆」「把这条记忆挪给干员」「记忆满了」「策展记忆」, or
  before writing a fact that only matters to one room or one person.
---

# 策展记忆（四轴）

> 这不是 Mnemon 文档库，也不是 standing `AGENTS.md` / `SOUL.md`。
> 这里只放**该跨会话存活的短事实**；一次性的进度、待办、临时状态一律进 `todo_write`。

## 四条轴

四个 zone 各管一件事，互不重叠。写之前先问：**这条事实的适用范围是什么？**

| Zone | 目录 | 跟随 | 谁读得到 | 寿命 |
|---|---|---|---|---|
| **global** | `memories/MEMORY.md` | 整台机器 | 每个 agent、每个工作区 | 永久（除非删） |
| **workspace** | `memories/workspaces/<wsId>/` | 房间 | 该工作区里所有会话 | 房间在就在 |
| **agent** | `memories/agents/<memberId>/` | 人 | 同一个人，无论坐哪 | 干员在就在 |
| **session** | `memories/sessions/<rootSid>/` | 委派树 | 树根 + 它派出的所有子/孙 | **树根会话删了就没** |

**session 层是工作台，不是"每个会话各一间"。** 父会话和它 `subagent` 出来的每一层共享同一个 `sessions/<rootSid>/`；兄弟会话（另开的对话）各有各的。判据是 `humanFacingSessionId()` —— 沿 parent 链向上走到头，遇 fork 就停。

**agent 层跟着人不跟着座位。** 同一个干员坐在自己 agent-home 里、被 `subagent` 派出去干活、被 `followup_task` 唤醒，读写的都是 `agents/<同一个 memberId>/`。这就是为什么它换座位不丢经验。项目工作区的顶层会话是经理（`mem_seed_manager`）；向阳空间是向日葵（`mem_seed_xrkseek`）——两个不同的人，两层记忆，绝不混用。

**USER.md 不是你的。** 每个 zone 里的 `USER.md` 是**注入层**：它描述"这个人是谁"，手工维护。`memory` 工具只接受 `target=memory`（MEMORY.md），不提供 `user` 写入入口。需要改画像时告诉用户，由人改。

## 归属判定

按顺序问，命中即停：

```
① 所有机器 / 所有 agent 都该知道？        → global
② 换另一个人接这活就不成立了？             → workspace（房间的事实）
③ 只跟"这个人怎么做这件事"有关？           → agent（人的经验）
④ 只对这次任务/这一轮有用？                → session（会随会话消失）
⑤ 只对此刻有用？                          → 别写，用 todo_write
```

**典型归属**

| 事实 | 放哪 | 为什么 |
|---|---|---|
| "发版先 publish SDK 再 CLI" | agent（发版员） | 是这位干员的专业经验 |
| "本仓 npm 发布走直连，绝不带 --proxy" | workspace | 这个仓库/组织的事实 |
| "用户要求思考与回复一律用简体中文" | global（或 USER.md 手改） | 跨所有会话成立 |
| "本机 DNS 不解析 xrk.siphot.com，以 AGT 明文源验证" | workspace 或 global | 整台机器的环境事实 → global；只关某个部署 → workspace |
| "这轮正在改 session-capability.ts" | session | 一轮工作的工作记忆 |
| "下一步跑 pnpm check" | todo_write | 计划，不是事实 |

**最容易搞错的两类**

- **把房间的事实写成全局。** 某个仓库的构建约定、某个项目的路径，一旦进了 global 会污染所有工作区。→ workspace。
- **把人的经验写进房间。** 发版员踩的坑、检索员总结的检索策略，应该跟着那个人。写进 workspace 后换个干员干同样的活就学不到。→ agent。

## 审计与迁移

用 `memory` 的 `list` 看当前冻结层的条目；看别的 zone 时直接读盘（路径规则见上表）。

### 读盘（只读，安全）

```powershell
$h = "$env:USERPROFILE\.xrk\memories"
# 各 zone 现状
Get-ChildItem $h -Directory | ForEach-Object { "$($_.Name)\" }
# 某工作区最近产生的记忆
Get-ChildItem "$h\workspaces" -Directory |
  Sort-Object LastWriteTime -Descending | Select-Object -First 5 Name, LastWriteTime
# 某干员的记忆
Get-Content "$h\agents\mem_79b88365ff3540d6\MEMORY.md"
```

`workspaceId` 与 `memberId` 都要从工具拿，别猜：`workspace_list` / `team_list`。

### 迁移一条记忆（三步，必须按序）

1. **写入目的地**（先写后删 —— 中途失败也不会丢）
2. **核对**目的地文件里确实有这条（`list` 或读盘）
3. **从源删除**（`memory` 的 `remove` + `old_text`，或直接编辑那个文件）

> **绝不先删后写。** 记忆没有回收站。

### 跨 zone 迁移只能手改文件

`memory` 工具**只写当前会话的默认 zone**（有 agent 身份时是 agent，否则 session）。要把一条事实挪到 global / 某个干员 / 某个工作区，就得：

1. 用文件工具读目标 `MEMORY.md`
2. 追加/改写（保持 `§` 分隔符这一既有格式）
3. 从源文件移除

改之前确认目标目录存在；`memories/workspaces/` 首次写入时需要建目录。

## 容量

每个 zone 都有字符上限（global 远小于 workspace/agent）。满了会触发自愈：

- **soft trim**：最久未触碰的条目被挤进 `.trim-log.jsonl` 并从正文移除
- 报错带 `prune_candidates`：最久未动的那几条，优先压缩或删除

**上限是信号，不是障碍**：撞墙说明这个 zone 塞了不属于它的东西。先按归属表拆出去，再考虑删。

## 会话结束的自动巩固

两阶段，都在会话结束时跑：

| | 做法 | 成本 |
|---|---|---|
| **Phase1** | 正则扫用户原话里的 `记住…` / `remember that…` / 偏好句，未覆盖的追加进默认 zone | 零 |
| **Phase2** | 把用户原话喂 LLM 抽"短事实"，最多 8 条 | 一次模型调用，**默认关** |

Phase2 默认关闭是有意的：它和 Phase1 写同一个文件、共用字符串包含去重，LLM 换个说法就绕过；而且它写默认 zone，可能在 session 层写出会随会话消失的事实。**只在确实需要语义归纳时才开。**

## 落笔前自检

- [ ] 这条事实换个会话还成立吗？不成立 → `todo_write`
- [ ] 它只在某一个房间成立吗？→ workspace，别塞 global
- [ ] 它是某位干员的经验吗？→ agent，别塞 workspace
- [ ] 我在动 `USER.md` 吗？→ 停，那是人的
- [ ] 迁移时我是先写后删吗？
- [ ] 目标 zone 的文件存在吗？

## 反模式

- ❌ 把工具输出/后台任务日志当记忆存进去（`agents/` 里已出现过这种脏数据）
- ❌ 为了"记得牢"把所有东西都塞 global，直到 3500 字符被 trim
- ❌ 用 `memory` 工具改 `USER.md`
- ❌ 删了再想在别的 zone 重建
- ❌ 把"下一步要做什么"写成记忆
