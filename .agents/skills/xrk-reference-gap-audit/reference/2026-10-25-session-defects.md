# 2026-10-25 会话底层缺陷笔记（归档）

> **排期真源（合并后）**：[docs/session-optimize.md](../../../../docs/session-optimize.md)
>
> 本文保留 10-25 当日修法记录；「假差距 / 仍开放」两节**已过期**，勿按旧表开工。

**基线当日**：本仓 · DSH `dsh-v0.2.1-rc.3`。方法：DSH 中文子系统文档 → 本仓 grep → 四类判定。

## 已修（当日，有撤回验证）

### D-1 `asOfSeq` 取了最高水位 → 改最低水位

- 消费点：`projection-store` 用 `asOfSeq` 做增量基线。
- 修：`session-projection` snapshot · `lowestCheckpointSeq`。

### D-2 shadow git 永不回收 → `reclaim()`

- `maintenance.auto=false` 前提下须显式 gc；`workspaceCheckpointStoreFor` 首次建 store 时 `void reclaim()`。
- `prune(keep)` 仍无产品调用点（见合并 README **R10**）。

### D-3 FTS 读失败静默空 → resident 兜底 + 诊断

### D-4 短于 3 码点查询零命中 → `planFtsQuery` LIKE

## 旧「假差距」表（过期 — 见合并 README §2）

| 当日说法 | 2026-10-27 裁决 |
|---|---|
| 搜索第 21 条后不可达 = 假差距（UI 未接） | 协议已有 `cursor`；UI 未接 ≠ 能力不该有 |
| `forked` 不需要 | 已落地 `session/end-seed` + `forked` |
| 冷缓存贴旧标题 | 已落地 identity + predecessorTitle |
| 列表「人性活动」排序 | 仍可视为非缺陷（`updatedAt` 已混 lastPromptAt） |

## 旧「仍开放」表（过期 — 见合并 README §1）

| 当日 | 现 |
|---|---|
| checkpoint restore 文件≠对话 | **仍开放 R1** |
| 会话元数据落 sessions 表 | **定位差异**（sidecar / 运行时重算） |
| 投影 checkpoint hydrate | list-tier **已做**；重键 = 可选 **R9** |
